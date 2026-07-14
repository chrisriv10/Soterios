# Troubleshooting

## Installation issues

### Installer requires administrator

Soterios needs admin rights for firewall management, Defender controls, and system audits. Right-click the installer and choose **Run as administrator**.

### App won't start after install

1. Try disabling GPU acceleration:
   ```cmd
   set SOTERIOS_DISABLE_GPU=1 && "C:\Program Files\Soterios\Soterios.exe"
   ```
2. Check `%APPDATA%\Soterios\` for corrupt database — rename `soterios.db` to reset settings (loses history).
3. Reinstall from the latest release.

---

## Scan problems

### Scan fails immediately

- Confirm ClamAV binaries exist in the install directory under `assets/clamav/`.
- Run `npm install` again if building from source (triggers the ClamAV download script).
- Check that you have read access to the target paths.

### Scan is very slow

Full scans of `C:\` can take hours depending on disk size and file count. Use **Quick Scan** for routine checks and **Custom Scan** for specific folders.

### Threat not detected

Update ClamAV definitions. Zero-day or custom malware may not be in signature databases — Soterios relies on ClamAV signatures, not a proprietary engine.

---

## ClamAV update issues

### Definition update fails

- Verify internet connectivity.
- Corporate proxies may block freshclam — configure proxy settings at the OS level.
- Retry from **Dashboard → ClamAV Definitions → Update**.

### Definitions show as outdated after update

Restart Soterios and check again. If the issue persists, delete the ClamAV database folder in the install directory and re-run update.

---

## Permission errors

### Audit checks return Error

Run Soterios as administrator. Some PowerShell cmdlets (`Get-BitLockerVolume`, `Confirm-SecureBootUEFI`) require elevated privileges.

### Real-time protection toggle fails

Windows **Tamper Protection** may block third-party apps from changing Defender settings. Disable Tamper Protection temporarily in **Windows Security → Virus & threat protection → Manage settings**.

### Firewall changes rejected

Ensure the Windows Firewall service is running and Soterios has admin rights.

---

## Frequently asked questions

**Does Soterios replace Windows Defender?**  
No. Soterios supplements Defender with ClamAV scanning, audits, and monitoring. Real-time protection toggles Defender itself.

**Is my data sent to the cloud?**  
Not by default. See [Privacy and Security](Privacy-and-Security.md).

**Can I use Soterios on macOS or Linux?**  
Not yet. Windows is the primary supported platform.

**Where are my scan reports?**  
`%USERPROFILE%\.soterios\scan-reports\` and the in-app **Reports** page.

**How do I report a bug?**  
Open an issue on [GitHub](https://github.com/chrisriv10/Soterios/issues). For security issues, follow `SECURITY.md`.
