#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

#define PATH_BUF_LEN 4096
#define CMD_BUF_LEN 32768

static int is_regular_file_fullpath_w(const wchar_t *candidate, wchar_t *full_out, size_t out_cap) {
    if (!candidate || !*candidate) return 0;
    DWORD len = GetFullPathNameW(candidate, (DWORD)out_cap, full_out, NULL);
    if (len == 0 || len >= out_cap) return 0;
    DWORD attrs = GetFileAttributesW(full_out);
    return (attrs != INVALID_FILE_ATTRIBUTES) && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static const wchar_t *skip_program_arg_w(const wchar_t *cmdline) {
    const wchar_t *p = cmdline;
    if (!p) return L"";

    while (*p == L' ' || *p == L'\t') {
        p++;
    }
    if (*p == L'"') {
        p++;
        while (*p && *p != L'"') {
            p++;
        }
        if (*p == L'"') {
            p++;
        }
    } else {
        while (*p && *p != L' ' && *p != L'\t') {
            p++;
        }
    }
    while (*p == L' ' || *p == L'\t') {
        p++;
    }
    return p;
}

static int resolve_launch_script_w(const wchar_t *exe_dir, wchar_t *out_path, size_t out_cap) {
    wchar_t candidate[PATH_BUF_LEN];

    /* 1. <exe_dir>\scripts\launch.mjs */
    if (swprintf(candidate, PATH_BUF_LEN, L"%ls\\scripts\\launch.mjs", exe_dir) > 0 &&
        is_regular_file_fullpath_w(candidate, out_path, out_cap)) {
        return 1;
    }

    /* 2. <exe_dir>\..\scripts\launch.mjs */
    if (swprintf(candidate, PATH_BUF_LEN, L"%ls\\..\\scripts\\launch.mjs", exe_dir) > 0 &&
        is_regular_file_fullpath_w(candidate, out_path, out_cap)) {
        return 1;
    }

    /* 3. <exe_dir>\launch.mjs */
    if (swprintf(candidate, PATH_BUF_LEN, L"%ls\\launch.mjs", exe_dir) > 0 &&
        is_regular_file_fullpath_w(candidate, out_path, out_cap)) {
        return 1;
    }

    return 0;
}

static HANDLE create_kill_on_close_job(void) {
    HANDLE hJob = CreateJobObjectW(NULL, NULL);
    if (!hJob) return NULL;

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli;
    ZeroMemory(&jeli, sizeof(jeli));
    /* Align with job-object.node FUN_1800014eb (0x2400) */
    jeli.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    if (!SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli))) {
        CloseHandle(hJob);
        return NULL;
    }
    return hJob;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    (void)hInstance;
    (void)hPrevInstance;
    (void)nCmdShow;

    wchar_t raw_exe_path[PATH_BUF_LEN];
    DWORD len = GetModuleFileNameW(NULL, raw_exe_path, PATH_BUF_LEN);
    if (len == 0 || len >= PATH_BUF_LEN) {
        fwprintf(stderr, L"[launcher] Failed to resolve executable path.\n");
        return 1;
    }

    wchar_t exe_path[PATH_BUF_LEN];
    if (!is_regular_file_fullpath_w(raw_exe_path, exe_path, PATH_BUF_LEN)) {
        fwprintf(stderr, L"[launcher] Executable path validation failed.\n");
        return 1;
    }

    wchar_t *last_slash = wcsrchr(exe_path, L'\\');
    if (!last_slash) {
        last_slash = wcsrchr(exe_path, L'/');
    }
    if (!last_slash) {
        fwprintf(stderr, L"[launcher] Invalid executable directory.\n");
        return 1;
    }
    *last_slash = L'\0';

    wchar_t script_path[PATH_BUF_LEN];
    if (!resolve_launch_script_w(exe_path, script_path, PATH_BUF_LEN)) {
        fwprintf(stderr, L"[launcher] Could not find scripts\\launch.mjs relative to %ls.\n", exe_path);
        return 1;
    }

    wchar_t node_search[PATH_BUF_LEN];
    wchar_t node_full[PATH_BUF_LEN];
    DWORD found_node = SearchPathW(NULL, L"node.exe", NULL, PATH_BUF_LEN, node_search, NULL);
    const wchar_t *node_bin = L"node";
    if (found_node > 0 && found_node < PATH_BUF_LEN &&
        is_regular_file_fullpath_w(node_search, node_full, PATH_BUF_LEN)) {
        node_bin = node_full;
    }

    const wchar_t *args_tail = (lpCmdLine && *lpCmdLine)
        ? lpCmdLine
        : skip_program_arg_w(GetCommandLineW());

    wchar_t cmd_line[CMD_BUF_LEN];
    int written;
    if (args_tail && *args_tail) {
        written = swprintf(
            cmd_line,
            CMD_BUF_LEN,
            L"\"%ls\" \"%ls\" %ls",
            node_bin,
            script_path,
            args_tail
        );
    } else {
        written = swprintf(
            cmd_line,
            CMD_BUF_LEN,
            L"\"%ls\" \"%ls\"",
            node_bin,
            script_path
        );
    }

    if (written < 0 || written >= CMD_BUF_LEN) {
        fwprintf(stderr, L"[launcher] Command line exceeds buffer limit.\n");
        return 1;
    }

    HANDLE hJob = create_kill_on_close_job();

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);

    /* Align with workbuddy-editor-sdk-supervisor.exe (FUN_140003ed0 / FUN_1400063a0):
       Create suspended under CREATE_NO_WINDOW, assign to KILL_ON_JOB_CLOSE job,
       and fall back to CREATE_BREAKAWAY_FROM_JOB if nested job assignment fails. */
    DWORD base_flags = CREATE_NO_WINDOW | CREATE_SUSPENDED;
    wchar_t cmd_copy[CMD_BUF_LEN];
    wcscpy(cmd_copy, cmd_line);

    BOOL ok = CreateProcessW(
        NULL,
        cmd_copy,
        NULL,
        NULL,
        TRUE,
        base_flags,
        NULL,
        NULL,
        &si,
        &pi
    );

    if (!ok) {
        DWORD err = GetLastError();
        if (hJob) CloseHandle(hJob);
        fwprintf(stderr, L"[launcher] CreateProcessW failed (error %lu).\n", err);
        return 1;
    }

    if (hJob && !AssignProcessToJobObject(hJob, pi.hProcess)) {
        /* Retry with CREATE_BREAKAWAY_FROM_JOB if parent job blocks nested assignment */
        TerminateProcess(pi.hProcess, 1);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);

        ZeroMemory(&si, sizeof(si));
        ZeroMemory(&pi, sizeof(pi));
        si.cb = sizeof(si);
        wcscpy(cmd_copy, cmd_line);

        BOOL breakaway_ok = CreateProcessW(
            NULL,
            cmd_copy,
            NULL,
            NULL,
            TRUE,
            base_flags | CREATE_BREAKAWAY_FROM_JOB,
            NULL,
            NULL,
            &si,
            &pi
        );

        if (breakaway_ok) {
            if (!AssignProcessToJobObject(hJob, pi.hProcess)) {
                CloseHandle(hJob);
                hJob = NULL;
            }
        } else {
            /* If parent job forbids breakaway, still allow child execution without job handle */
            CloseHandle(hJob);
            hJob = NULL;
            ZeroMemory(&si, sizeof(si));
            ZeroMemory(&pi, sizeof(pi));
            si.cb = sizeof(si);
            wcscpy(cmd_copy, cmd_line);
            if (!CreateProcessW(NULL, cmd_copy, NULL, NULL, TRUE, base_flags, NULL, NULL, &si, &pi)) {
                DWORD err = GetLastError();
                fwprintf(stderr, L"[launcher] Fallback CreateProcessW failed (error %lu).\n", err);
                return 1;
            }
        }
    }

    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exit_code = 1;
    if (!GetExitCodeProcess(pi.hProcess, &exit_code)) {
        exit_code = 1;
    }

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    if (hJob) {
        CloseHandle(hJob);
    }
    return (int)exit_code;
}
