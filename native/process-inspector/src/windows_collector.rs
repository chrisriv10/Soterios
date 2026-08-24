use anyhow::{Result, anyhow};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, LookupAccountSidW,
    SID_NAME_USE, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TOKEN_USER, TokenIntegrityLevel, TokenUser,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, PROCESSENTRY32W,
    Process32FirstW, Process32NextW, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
    TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows::Win32::System::ProcessStatus::{
    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
};
use windows::Win32::System::SystemInformation::{
    GlobalMemoryStatusEx, IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_ARM64,
    IMAGE_FILE_MACHINE_I386, IMAGE_FILE_MACHINE_UNKNOWN, MEMORYSTATUSEX,
};
use windows::Win32::System::Threading::{
    GetPriorityClass, GetProcessAffinityMask, GetProcessHandleCount, GetProcessInformation,
    GetProcessIoCounters, GetProcessTimes, GetSystemTimes, IO_COUNTERS, IsWow64Process2,
    OpenProcess, OpenProcessToken, OpenThread, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    PROCESS_POWER_THROTTLING_STATE, PROCESS_PROTECTION_LEVEL_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION, PROCESS_TERMINATE, PROCESS_VM_READ,
    ProcessPowerThrottling, ProcessProtectionLevelInfo, QueryFullProcessImageNameW, ResumeThread,
    SetProcessInformation, SuspendThread, THREAD_SUSPEND_RESUME, TerminateProcess,
};
use windows::core::{PCWSTR, PWSTR};

const FILETIME_UNIX_EPOCH: u64 = 116_444_736_000_000_000;

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[derive(Clone, Copy)]
struct CpuTimes {
    kernel: u64,
    user: u64,
}

#[derive(Clone, Copy)]
struct IoTimes {
    read: u64,
    write: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessKey {
    pid: u32,
    started_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignatureInfo {
    status: &'static str,
    publisher: Option<String>,
    checked_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessRecord {
    key: ProcessKey,
    pid: u32,
    ppid: Option<u32>,
    started_at: Option<String>,
    name: String,
    path: Option<String>,
    command_line: Option<String>,
    args: Option<String>,
    user: Option<String>,
    state: &'static str,
    architecture: Option<String>,
    integrity_level: Option<String>,
    protection_level: Option<String>,
    signature: SignatureInfo,
    cpu: Option<f64>,
    cpu_user: Option<f64>,
    cpu_system: Option<f64>,
    memory_percent: Option<f64>,
    working_set_bytes: Option<u64>,
    private_bytes: Option<u64>,
    commit_bytes: Option<u64>,
    virtual_bytes: Option<u64>,
    io_read_bytes_per_sec: Option<u64>,
    io_write_bytes_per_sec: Option<u64>,
    disk_read_bytes_per_sec: Option<u64>,
    disk_write_bytes_per_sec: Option<u64>,
    network_receive_bytes_per_sec: Option<u64>,
    network_send_bytes_per_sec: Option<u64>,
    gpu_percent: Option<f64>,
    gpu_dedicated_bytes: Option<u64>,
    gpu_shared_bytes: Option<u64>,
    handles: Option<u32>,
    threads: u32,
    priority: Option<u32>,
    affinity_mask: Option<u64>,
    efficiency_mode: Option<bool>,
}

pub struct WindowsCollector {
    last_sample: Instant,
    last_cpu: HashMap<String, CpuTimes>,
    last_io: HashMap<String, IoTimes>,
    last_system_cpu: Option<(u64, u64, u64)>,
    logical_processors: f64,
}

impl WindowsCollector {
    pub fn new() -> Self {
        Self {
            last_sample: Instant::now(),
            last_cpu: HashMap::new(),
            last_io: HashMap::new(),
            last_system_cpu: None,
            logical_processors: std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(1) as f64,
        }
    }

    pub fn snapshot(&mut self) -> Result<Value> {
        let elapsed = self.last_sample.elapsed().as_secs_f64().max(0.001);
        self.last_sample = Instant::now();
        let (memory_used, memory_total, memory_percent) = memory_status();
        let system_cpu = self.system_cpu_percent();
        let snapshot = OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? });
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut records = Vec::new();
        let mut next_cpu = HashMap::new();
        let mut next_io = HashMap::new();

        if unsafe { Process32FirstW(snapshot.0, &mut entry) }.is_ok() {
            loop {
                records.push(self.process_record(
                    entry.th32ProcessID,
                    entry.th32ParentProcessID,
                    entry.cntThreads,
                    utf16z(&entry.szExeFile),
                    elapsed,
                    memory_total,
                    &mut next_cpu,
                    &mut next_io,
                ));
                if unsafe { Process32NextW(snapshot.0, &mut entry) }.is_err() {
                    break;
                }
            }
        }
        self.last_cpu = next_cpu;
        self.last_io = next_io;
        Ok(json!({
            "protocolVersion": 1,
            "collectedAt": now_ms().to_string(),
            "capabilities": capabilities(),
            "totals": {
                "cpuPercent": system_cpu,
                "memoryPercent": memory_percent,
                "memoryUsedBytes": memory_used,
                "memoryTotalBytes": memory_total,
                "diskReadBytesPerSec": null,
                "diskWriteBytesPerSec": null,
                "networkReceiveBytesPerSec": null,
                "networkSendBytesPerSec": null,
                "gpuPercent": null
            },
            "processes": records
        }))
    }

    #[allow(clippy::too_many_arguments)]
    fn process_record(
        &self,
        pid: u32,
        ppid: u32,
        threads: u32,
        name: String,
        elapsed: f64,
        total_memory: u64,
        next_cpu: &mut HashMap<String, CpuTimes>,
        next_io: &mut HashMap<String, IoTimes>,
    ) -> ProcessRecord {
        let process = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                false,
                pid,
            )
        }
        .or_else(|_| unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
        .ok()
        .map(OwnedHandle);
        let mut start_ticks = format!("pid-{pid}-unavailable");
        let mut started_at = None;
        let mut cpu = None;
        let mut cpu_user = None;
        let mut cpu_system = None;
        let mut path = None;
        let mut working_set = None;
        let mut private_bytes = None;
        let mut commit_bytes = None;
        let mut io_read = None;
        let mut io_write = None;
        let mut handles = None;
        let mut priority = None;
        let mut affinity = None;
        let mut efficiency = None;
        let mut architecture = None;
        let mut integrity = None;
        let mut protection = None;
        let mut user = None;

        if let Some(handle) = process.as_ref() {
            let mut creation = FILETIME::default();
            let mut exit = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user_time = FILETIME::default();
            if unsafe {
                GetProcessTimes(
                    handle.0,
                    &mut creation,
                    &mut exit,
                    &mut kernel,
                    &mut user_time,
                )
            }
            .is_ok()
            {
                let creation_ticks = filetime_ticks(creation);
                start_ticks = creation_ticks.to_string();
                started_at = Some(filetime_unix_ms(creation_ticks).to_string());
                let identity = format!("{pid}@{start_ticks}");
                let current = CpuTimes {
                    kernel: filetime_ticks(kernel),
                    user: filetime_ticks(user_time),
                };
                if let Some(previous) = self.last_cpu.get(&identity) {
                    let denominator = elapsed * 10_000_000.0 * self.logical_processors;
                    cpu_user = Some(
                        ((current.user.saturating_sub(previous.user) as f64 / denominator) * 100.0)
                            .clamp(0.0, 100.0),
                    );
                    cpu_system = Some(
                        ((current.kernel.saturating_sub(previous.kernel) as f64 / denominator)
                            * 100.0)
                            .clamp(0.0, 100.0),
                    );
                    cpu = Some(
                        (cpu_user.unwrap_or(0.0) + cpu_system.unwrap_or(0.0)).clamp(0.0, 100.0),
                    );
                }
                next_cpu.insert(identity, current);
            }
            path = query_path(handle.0);
            if let Some(memory) = query_memory(handle.0) {
                working_set = Some(memory.WorkingSetSize as u64);
                private_bytes = Some(memory.PrivateUsage as u64);
                commit_bytes = Some(memory.PagefileUsage as u64);
            }
            if let Some(io) = query_io(handle.0) {
                let identity = format!("{pid}@{start_ticks}");
                let current = IoTimes {
                    read: io.ReadTransferCount,
                    write: io.WriteTransferCount,
                };
                if let Some(previous) = self.last_io.get(&identity) {
                    io_read =
                        Some((current.read.saturating_sub(previous.read) as f64 / elapsed) as u64);
                    io_write = Some(
                        (current.write.saturating_sub(previous.write) as f64 / elapsed) as u64,
                    );
                }
                next_io.insert(identity, current);
            }
            let mut handle_count = 0;
            if unsafe { GetProcessHandleCount(handle.0, &mut handle_count) }.is_ok() {
                handles = Some(handle_count);
            }
            let class = unsafe { GetPriorityClass(handle.0) };
            if class != 0 {
                priority = Some(class);
            }
            let mut process_mask = 0usize;
            let mut system_mask = 0usize;
            if unsafe { GetProcessAffinityMask(handle.0, &mut process_mask, &mut system_mask) }
                .is_ok()
            {
                affinity = Some(process_mask as u64);
            }
            efficiency = query_efficiency(handle.0);
            architecture = query_architecture(handle.0);
            protection = query_protection(handle.0);
            if let Some((owner, level)) = query_security(handle.0) {
                user = owner;
                integrity = level;
            }
        }
        let memory_percent = working_set
            .filter(|_| total_memory > 0)
            .map(|value| value as f64 / total_memory as f64 * 100.0);
        ProcessRecord {
            key: ProcessKey {
                pid,
                started_at: start_ticks,
            },
            pid,
            ppid: (ppid != 0).then_some(ppid),
            started_at,
            name,
            path,
            command_line: None,
            args: None,
            user,
            state: "running",
            architecture,
            integrity_level: integrity,
            protection_level: protection,
            signature: SignatureInfo {
                status: "Unknown",
                publisher: None,
                checked_at: None,
            },
            cpu,
            cpu_user,
            cpu_system,
            memory_percent,
            working_set_bytes: working_set,
            private_bytes,
            commit_bytes,
            virtual_bytes: None,
            io_read_bytes_per_sec: io_read,
            io_write_bytes_per_sec: io_write,
            disk_read_bytes_per_sec: None,
            disk_write_bytes_per_sec: None,
            network_receive_bytes_per_sec: None,
            network_send_bytes_per_sec: None,
            gpu_percent: None,
            gpu_dedicated_bytes: None,
            gpu_shared_bytes: None,
            handles,
            threads,
            priority,
            affinity_mask: affinity,
            efficiency_mode: efficiency,
        }
    }

    fn system_cpu_percent(&mut self) -> Option<f64> {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.is_err() {
            return None;
        }
        let current = (
            filetime_ticks(idle),
            filetime_ticks(kernel),
            filetime_ticks(user),
        );
        let result = self.last_system_cpu.map(|previous| {
            let idle_delta = current.0.saturating_sub(previous.0);
            let kernel_delta = current.1.saturating_sub(previous.1);
            let user_delta = current.2.saturating_sub(previous.2);
            let total = kernel_delta.saturating_add(user_delta);
            if total == 0 {
                0.0
            } else {
                ((total.saturating_sub(idle_delta)) as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
            }
        });
        self.last_system_cpu = Some(current);
        result
    }

    pub fn details(&mut self, params: &Value) -> Result<Value> {
        let pid = params
            .pointer("/processKey/pid")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("Missing process ID"))? as u32;
        let started_at = params
            .pointer("/processKey/startedAt")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("Missing process start time"))?;
        revalidate_process(pid, started_at)?;
        let requested = params
            .get("sections")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut sections = Map::new();
        let mut errors = Map::new();
        for section in requested.iter().filter_map(Value::as_str) {
            match section {
                "modules" => match enumerate_modules(pid) {
                    Ok(value) => {
                        sections.insert(section.into(), value);
                    }
                    Err(error) => {
                        sections.insert(section.into(), json!([]));
                        errors.insert(section.into(), json!(error.to_string()));
                    }
                },
                "threads" => match enumerate_threads(pid) {
                    Ok(value) => {
                        sections.insert(section.into(), value);
                    }
                    Err(error) => {
                        sections.insert(section.into(), json!([]));
                        errors.insert(section.into(), json!(error.to_string()));
                    }
                },
                "handles" => {
                    sections.insert(section.into(), json!([]));
                    errors.insert(
                        section.into(),
                        json!("Named-handle enumeration is unavailable without a driver"),
                    );
                }
                "waitChain" => {
                    sections.insert(section.into(), json!([]));
                    errors.insert(
                        section.into(),
                        json!("Wait-chain analysis is not available in this collector build"),
                    );
                }
                "network" => {
                    sections.insert(section.into(), json!([]));
                    errors.insert(
                        section.into(),
                        json!("Network correlation is supplied by the main process"),
                    );
                }
                _ => {
                    sections.insert(section.into(), json!([]));
                }
            }
        }
        Ok(json!({
            "processKey": params.get("processKey"),
            "sections": sections,
            "capabilityErrors": errors
        }))
    }

    pub fn action(&mut self, params: &Value) -> Result<Value> {
        let pid = params
            .pointer("/processKey/pid")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("Missing process ID"))? as u32;
        let started_at = params
            .pointer("/processKey/startedAt")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("Missing process start time"))?;
        revalidate_process(pid, started_at)?;
        match params.get("action").and_then(Value::as_str).unwrap_or("") {
            "terminate" => {
                let process = OwnedHandle(unsafe { OpenProcess(PROCESS_TERMINATE, false, pid)? });
                unsafe { TerminateProcess(process.0, 1)? };
                Ok(json!({ "success": true }))
            }
            "suspend" => Ok(json!({
                "success": true,
                "threadsChanged": change_thread_suspend(pid, true)?
            })),
            "resume" => Ok(json!({
                "success": true,
                "threadsChanged": change_thread_suspend(pid, false)?
            })),
            "setEfficiencyMode" => {
                let enabled = params
                    .pointer("/options/enabled")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| anyhow!("Missing efficiency-mode state"))?;
                set_efficiency(pid, enabled)?;
                Ok(json!({ "success": true, "enabled": enabled }))
            }
            _ => Err(anyhow!("Unsupported native process action")),
        }
    }
}

fn filetime_ticks(value: FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

fn filetime_unix_ms(ticks: u64) -> u64 {
    ticks.saturating_sub(FILETIME_UNIX_EPOCH) / 10_000
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn utf16z(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

fn memory_status() -> (Option<u64>, u64, Option<f64>) {
    let mut status = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) }.is_err() {
        return (None, 0, None);
    }
    let used = status.ullTotalPhys.saturating_sub(status.ullAvailPhys);
    (
        Some(used),
        status.ullTotalPhys,
        Some(status.dwMemoryLoad as f64),
    )
}

fn query_path(process: HANDLE) -> Option<String> {
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            process,
            Default::default(),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    }
    .ok()
    .map(|_| String::from_utf16_lossy(&buffer[..length as usize]))
}

fn query_memory(process: HANDLE) -> Option<PROCESS_MEMORY_COUNTERS_EX> {
    let mut counters = PROCESS_MEMORY_COUNTERS_EX {
        cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    unsafe {
        GetProcessMemoryInfo(
            process,
            (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
            size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        )
    }
    .ok()
    .map(|_| counters)
}

fn query_io(process: HANDLE) -> Option<IO_COUNTERS> {
    let mut counters = IO_COUNTERS::default();
    unsafe { GetProcessIoCounters(process, &mut counters) }
        .ok()
        .map(|_| counters)
}

fn query_architecture(process: HANDLE) -> Option<String> {
    let mut process_machine = IMAGE_FILE_MACHINE_UNKNOWN;
    let mut native_machine = IMAGE_FILE_MACHINE_UNKNOWN;
    unsafe { IsWow64Process2(process, &mut process_machine, Some(&mut native_machine)) }.ok()?;
    let machine = if process_machine == IMAGE_FILE_MACHINE_UNKNOWN {
        native_machine
    } else {
        process_machine
    };
    Some(
        if machine == IMAGE_FILE_MACHINE_AMD64 {
            "x64"
        } else if machine == IMAGE_FILE_MACHINE_ARM64 {
            "arm64"
        } else if machine == IMAGE_FILE_MACHINE_I386 {
            "x86"
        } else {
            "unknown"
        }
        .to_string(),
    )
}

fn query_efficiency(process: HANDLE) -> Option<bool> {
    let mut state = PROCESS_POWER_THROTTLING_STATE {
        Version: 1,
        ..Default::default()
    };
    unsafe {
        GetProcessInformation(
            process,
            ProcessPowerThrottling,
            (&mut state as *mut PROCESS_POWER_THROTTLING_STATE).cast(),
            size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )
    }
    .ok()?;
    Some(
        state.ControlMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED != 0
            && state.StateMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED != 0,
    )
}

fn query_protection(process: HANDLE) -> Option<String> {
    let mut info = PROCESS_PROTECTION_LEVEL_INFORMATION::default();
    unsafe {
        GetProcessInformation(
            process,
            ProcessProtectionLevelInfo,
            (&mut info as *mut PROCESS_PROTECTION_LEVEL_INFORMATION).cast(),
            size_of::<PROCESS_PROTECTION_LEVEL_INFORMATION>() as u32,
        )
    }
    .ok()?;
    Some(
        match info.ProtectionLevel.0 {
            0 => "WinTcb Light",
            1 => "Windows",
            2 => "Windows Light",
            3 => "Antimalware Light",
            4 => "LSA Light",
            5 => "WinTcb",
            6 => "CodeGen Light",
            7 => "Authenticode",
            8 => "PPL App",
            0xFFFF_FFFE => "None",
            _ => "Unknown",
        }
        .to_string(),
    )
}

fn token_buffer(
    token: HANDLE,
    class: windows::Win32::Security::TOKEN_INFORMATION_CLASS,
) -> Option<Vec<u8>> {
    let mut length = 0u32;
    let _ = unsafe { GetTokenInformation(token, class, None, 0, &mut length) };
    if length == 0 {
        return None;
    }
    let mut buffer = vec![0u8; length as usize];
    unsafe {
        GetTokenInformation(
            token,
            class,
            Some(buffer.as_mut_ptr().cast()),
            length,
            &mut length,
        )
    }
    .ok()?;
    Some(buffer)
}

fn query_security(process: HANDLE) -> Option<(Option<String>, Option<String>)> {
    let mut raw_token = HANDLE::default();
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw_token) }.ok()?;
    let token = OwnedHandle(raw_token);
    let owner = token_buffer(token.0, TokenUser).and_then(|buffer| {
        let token_user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
        let mut name_length = 0u32;
        let mut domain_length = 0u32;
        let mut use_type = SID_NAME_USE::default();
        let _ = unsafe {
            LookupAccountSidW(
                PCWSTR::null(),
                token_user.User.Sid,
                PWSTR::null(),
                &mut name_length,
                PWSTR::null(),
                &mut domain_length,
                &mut use_type,
            )
        };
        if name_length == 0 {
            return None;
        }
        let mut name = vec![0u16; name_length as usize];
        let mut domain = vec![0u16; domain_length.max(1) as usize];
        unsafe {
            LookupAccountSidW(
                PCWSTR::null(),
                token_user.User.Sid,
                PWSTR(name.as_mut_ptr()),
                &mut name_length,
                PWSTR(domain.as_mut_ptr()),
                &mut domain_length,
                &mut use_type,
            )
        }
        .ok()?;
        let name = utf16z(&name);
        let domain = utf16z(&domain);
        Some(if domain.is_empty() {
            name
        } else {
            format!("{domain}\\{name}")
        })
    });
    let integrity = token_buffer(token.0, TokenIntegrityLevel).and_then(|buffer| {
        let label = unsafe { &*(buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>()) };
        let count = unsafe { GetSidSubAuthorityCount(label.Label.Sid) };
        if count.is_null() || unsafe { *count } == 0 {
            return None;
        }
        let rid = unsafe { *GetSidSubAuthority(label.Label.Sid, (*count - 1) as u32) };
        Some(
            match rid {
                0..=4095 => "Untrusted",
                4096..=8191 => "Low",
                8192..=12287 => "Medium",
                12288..=16383 => "High",
                _ => "System",
            }
            .to_string(),
        )
    });
    Some((owner, integrity))
}

fn creation_ticks(pid: u32) -> Result<String> {
    let process =
        OwnedHandle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)? });
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe { GetProcessTimes(process.0, &mut creation, &mut exit, &mut kernel, &mut user)? };
    Ok(filetime_ticks(creation).to_string())
}

fn revalidate_process(pid: u32, expected: &str) -> Result<()> {
    if creation_ticks(pid)? != expected {
        return Err(anyhow!("Process ID was reused"));
    }
    Ok(())
}

fn enumerate_threads(pid: u32) -> Result<Value> {
    let snapshot = OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)? });
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut rows = Vec::new();
    if unsafe { Thread32First(snapshot.0, &mut entry) }.is_ok() {
        loop {
            if entry.th32OwnerProcessID == pid {
                rows.push(json!({
                    "threadId": entry.th32ThreadID,
                    "basePriority": entry.tpBasePri
                }));
            }
            if unsafe { Thread32Next(snapshot.0, &mut entry) }.is_err() {
                break;
            }
        }
    }
    Ok(json!(rows))
}

fn enumerate_modules(pid: u32) -> Result<Value> {
    let snapshot = OwnedHandle(unsafe {
        CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)?
    });
    let mut entry = MODULEENTRY32W {
        dwSize: size_of::<MODULEENTRY32W>() as u32,
        ..Default::default()
    };
    let mut rows = Vec::new();
    unsafe { Module32FirstW(snapshot.0, &mut entry)? };
    loop {
        rows.push(json!({
            "name": utf16z(&entry.szModule),
            "path": utf16z(&entry.szExePath),
            "baseAddress": entry.modBaseAddr as usize,
            "sizeBytes": entry.modBaseSize
        }));
        if unsafe { Module32NextW(snapshot.0, &mut entry) }.is_err() {
            break;
        }
    }
    Ok(json!(rows))
}

fn change_thread_suspend(pid: u32, suspend: bool) -> Result<u32> {
    let snapshot = OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)? });
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut changed = 0u32;
    if unsafe { Thread32First(snapshot.0, &mut entry) }.is_ok() {
        loop {
            if entry.th32OwnerProcessID == pid {
                if let Ok(raw) =
                    unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID) }
                {
                    let thread = OwnedHandle(raw);
                    let previous = if suspend {
                        unsafe { SuspendThread(thread.0) }
                    } else {
                        unsafe { ResumeThread(thread.0) }
                    };
                    if previous != u32::MAX {
                        changed += 1;
                    }
                }
            }
            if unsafe { Thread32Next(snapshot.0, &mut entry) }.is_err() {
                break;
            }
        }
    }
    if changed == 0 {
        return Err(anyhow!(
            "Windows did not allow access to any process threads"
        ));
    }
    Ok(changed)
}

fn set_efficiency(pid: u32, enabled: bool) -> Result<()> {
    let process = OwnedHandle(unsafe {
        OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        )?
    });
    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: 1,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: if enabled {
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        } else {
            0
        },
    };
    unsafe {
        SetProcessInformation(
            process.0,
            ProcessPowerThrottling,
            (&state as *const PROCESS_POWER_THROTTLING_STATE).cast::<c_void>(),
            size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )?
    };
    Ok(())
}

pub fn capabilities() -> Value {
    json!({
        "provider": "native-rust-windows-api",
        "native": true,
        "degraded": false,
        "intervalFloorMs": 500,
        "processTree": true,
        "cpu": true,
        "cpuUserKernel": true,
        "memory": true,
        "io": true,
        "diskIo": false,
        "networkIo": false,
        "gpu": false,
        "owner": true,
        "integrity": true,
        "architecture": true,
        "protectionLevel": true,
        "handles": false,
        "handleCount": true,
        "threads": true,
        "modules": true,
        "connections": false,
        "suspendResume": true,
        "affinity": true,
        "efficiencyMode": true,
        "dumps": true,
        "waitChain": false,
        "etw": false,
        "commandLine": false,
        "signature": false
    })
}
