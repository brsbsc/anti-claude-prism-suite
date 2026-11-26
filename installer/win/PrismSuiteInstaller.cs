using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Anti-Claude Prism Suite 一键安装器")]
[assembly: AssemblyDescription("Anti-Claude Prism Suite & Antigravity prism-files MCP App Installer")]
[assembly: AssemblyProduct("Anti-Claude Prism Suite")]
[assembly: AssemblyVersion("0.5.0.0")]
[assembly: AssemblyFileVersion("0.5.0.0")]

namespace AntiClaudePrismSuiteInstaller
{
    internal sealed class PayloadEntry
    {
        public string ResourceName;
        public string Category; // "extensions" or "plugin"
        public string RelativePath;
    }

    internal sealed class CliOptions
    {
        public bool SilentInstall;
        public bool SilentUninstall;
        public bool NoWsl;
        public string TestUserDir;
        public string TestPluginsDir;
    }

    internal sealed class WslDetectionResult
    {
        public List<string> Targets = new List<string>();
        public List<string> DistrosChecked = new List<string>();
        public string Summary;
    }

    internal static class InstallerCore
    {
        private const string ManifestResourceName = "payload.manifest.txt";
        private static readonly string[] ExtensionFileNames = new string[]
        {
            "prism-suite.css",
            "prism-suite.js",
            "prism-suite-fx.css",
            "prism-suite-fx.js",
            "prism-suite-workflow.css",
            "prism-suite-workflow.js"
        };

        public static string GetDefaultExtensionsDir()
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(
                Path.Combine(
                    Path.Combine(
                        Path.Combine(Path.Combine(profile, ".gemini"), "antigravity"),
                        "anti-claude"),
                    "user"),
                "extensions");
        }

        public static string GetDefaultPluginDir()
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(
                Path.Combine(Path.Combine(Path.Combine(profile, ".gemini"), "config"), "plugins"),
                "prism-files");
        }

        public static string NormalizePrismFilesTarget(string rawPath)
        {
            if (string.IsNullOrEmpty(rawPath) || rawPath.Trim().Length == 0)
            {
                throw new ArgumentException("插件目标目录不能为空。");
            }
            string trimmed = rawPath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (trimmed.Length == 2
                && ((trimmed[0] >= 'A' && trimmed[0] <= 'Z') || (trimmed[0] >= 'a' && trimmed[0] <= 'z'))
                && trimmed[1] == ':')
            {
                trimmed = trimmed + "\\";
            }
            string full = Path.GetFullPath(trimmed);
            if (!string.Equals(Path.GetFileName(full), "prism-files", StringComparison.OrdinalIgnoreCase))
            {
                full = Path.Combine(full, "prism-files");
            }
            return full;
        }

        public static List<PayloadEntry> LoadManifest()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            Stream stream = asm.GetManifestResourceStream(ManifestResourceName);
            if (stream == null)
            {
                throw new InvalidOperationException("安装包内部缺少资源清单：" + ManifestResourceName);
            }

            List<PayloadEntry> entries = new List<PayloadEntry>();
            using (stream)
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    string clean = line.Trim();
                    if (clean.Length == 0 || clean.StartsWith("#", StringComparison.Ordinal))
                    {
                        continue;
                    }
                    int sep = clean.IndexOf('|');
                    if (sep <= 0 || sep >= clean.Length - 1)
                    {
                        continue;
                    }

                    string resourceName = clean.Substring(0, sep).Trim();
                    string targetRel = clean.Substring(sep + 1).Trim().Replace('\\', '/');

                    if (targetRel.StartsWith("extensions/", StringComparison.OrdinalIgnoreCase)
                        && resourceName.StartsWith("payload.extensions.", StringComparison.Ordinal))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("extensions/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "extensions",
                            RelativePath = rel
                        });
                    }
                    else if (targetRel.StartsWith("plugin/", StringComparison.OrdinalIgnoreCase)
                        && resourceName.StartsWith("payload.plugin.", StringComparison.Ordinal))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("plugin/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "plugin",
                            RelativePath = rel
                        });
                    }
                }
            }

            if (entries.Count == 0)
            {
                throw new InvalidOperationException("安装包清单中未包含任何有效文件。");
            }
            return entries;
        }

        private static string ValidateSafeRelativePath(string rel)
        {
            if (string.IsNullOrEmpty(rel) || Path.IsPathRooted(rel))
            {
                throw new InvalidOperationException("非法清单相对路径：" + rel);
            }
            string[] parts = rel.Split(new char[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                throw new InvalidOperationException("清单相对路径为空。");
            }
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i] == "." || parts[i] == "..")
                {
                    throw new InvalidOperationException("清单相对路径包含非法跳转段：" + rel);
                }
            }
            return string.Join(Path.DirectorySeparatorChar.ToString(), parts);
        }

        private static void WriteResourceToFile(Assembly asm, string resourceName, string destPath)
        {
            string parent = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(parent))
            {
                Directory.CreateDirectory(parent);
            }
            string tmpPath = destPath + ".prism-tmp-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            try
            {
                using (Stream src = asm.GetManifestResourceStream(resourceName))
                {
                    if (src == null)
                    {
                        throw new InvalidOperationException("未找到内嵌资源：" + resourceName);
                    }
                    using (FileStream dst = new FileStream(tmpPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        src.CopyTo(dst);
                        dst.Flush(true);
                    }
                }
                File.Copy(tmpPath, destPath, true);
            }
            finally
            {
                try
                {
                    if (File.Exists(tmpPath)) File.Delete(tmpPath);
                }
                catch
                {
                }
            }
        }

        public static int InstallExtensions(string targetExtDir, List<PayloadEntry> entries, Action<string> log)
        {
            if (string.IsNullOrEmpty(targetExtDir) || targetExtDir.Trim().Length == 0)
            {
                throw new ArgumentException("Anti-Claude 扩展目标目录不能为空。");
            }

            string resolvedDir = Path.GetFullPath(targetExtDir.Trim());
            Directory.CreateDirectory(resolvedDir);

            Assembly asm = Assembly.GetExecutingAssembly();
            int count = 0;
            for (int i = 0; i < entries.Count; i++)
            {
                PayloadEntry entry = entries[i];
                if (!string.Equals(entry.Category, "extensions", StringComparison.Ordinal))
                {
                    continue;
                }
                string dest = Path.Combine(resolvedDir, entry.RelativePath);
                WriteResourceToFile(asm, entry.ResourceName, dest);
                count++;
                log(string.Format("  [扩展] 已写入: {0}", dest));
            }
            log(string.Format("[完成] Anti-Claude 棱镜扩展已安装至 {0}（共 {1} 个文件）", resolvedDir, count));
            return count;
        }

        public static int UninstallExtensions(string targetExtDir, Action<string> log)
        {
            if (string.IsNullOrEmpty(targetExtDir) || targetExtDir.Trim().Length == 0)
            {
                throw new ArgumentException("Anti-Claude 扩展目标目录不能为空。");
            }

            string resolvedDir = Path.GetFullPath(targetExtDir.Trim());
            int removed = 0;
            for (int i = 0; i < ExtensionFileNames.Length; i++)
            {
                string fp = Path.Combine(resolvedDir, ExtensionFileNames[i]);
                if (File.Exists(fp))
                {
                    File.Delete(fp);
                    removed++;
                    log(string.Format("  [扩展] 已移除: {0}", fp));
                }
            }
            if (removed == 0)
            {
                log(string.Format("[跳过] 未在 {0} 中发现 Prism Suite 扩展文件", resolvedDir));
            }
            else
            {
                log(string.Format("[完成] 已从 {0} 干净移除 {1} 个扩展文件（其余扩展已保留）", resolvedDir, removed));
            }
            return removed;
        }

        public static int InstallPlugin(string rawPluginTargetDir, List<PayloadEntry> entries, Action<string> log)
        {
            string targetDir = NormalizePrismFilesTarget(rawPluginTargetDir);
            if (!string.Equals(Path.GetFileName(targetDir), "prism-files", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安全拦截：插件目录末尾必须为 prism-files：" + targetDir);
            }

            string parentPluginsDir = Path.GetDirectoryName(targetDir);
            if (!string.IsNullOrEmpty(parentPluginsDir))
            {
                Directory.CreateDirectory(parentPluginsDir);
            }

            bool existed = Directory.Exists(targetDir);
            // Preserve root directory inode in-place so running MCP server processes (Windows/WSL) never lose cwd
            Directory.CreateDirectory(targetDir);
            if (existed)
            {
                log(string.Format("  [插件] 正在原地增量更新（保留目录句柄）: {0}", targetDir));
            }

            Assembly asm = Assembly.GetExecutingAssembly();
            HashSet<string> expectedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int count = 0;
            for (int i = 0; i < entries.Count; i++)
            {
                PayloadEntry entry = entries[i];
                if (!string.Equals(entry.Category, "plugin", StringComparison.Ordinal))
                {
                    continue;
                }
                string dest = Path.GetFullPath(Path.Combine(targetDir, entry.RelativePath));
                WriteResourceToFile(asm, entry.ResourceName, dest);
                expectedFiles.Add(dest);
                count++;
            }

            int pruned = PruneObsoletePluginEntries(targetDir, Path.GetFullPath(targetDir), expectedFiles, true);
            if (pruned > 0)
            {
                log(string.Format("  [插件] 已清理 {0} 个旧版残留条目", pruned));
            }
            log(string.Format("[完成] Prism 文件工作台插件已部署至 {0}（共 {1} 个文件）", targetDir, count));
            return count;
        }

        private static bool IsReparsePoint(string path)
        {
            try
            {
                FileAttributes attrs = File.GetAttributes(path);
                return (attrs & FileAttributes.ReparsePoint) != 0;
            }
            catch
            {
                return true;
            }
        }

        private static bool IsInsideRoot(string fullPath, string rootFull)
        {
            string normRoot = rootFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return fullPath.StartsWith(normRoot, StringComparison.OrdinalIgnoreCase);
        }

        private static int PruneObsoletePluginEntries(string dirPath, string rootFull, HashSet<string> expectedFiles, bool isRoot)
        {
            int removed = 0;
            try
            {
                if (!isRoot && IsReparsePoint(dirPath))
                {
                    return 0;
                }
                string[] files = Directory.GetFiles(dirPath);
                for (int i = 0; i < files.Length; i++)
                {
                    string full = Path.GetFullPath(files[i]);
                    if (!IsInsideRoot(full, rootFull) || IsReparsePoint(full))
                    {
                        continue;
                    }
                    if (!expectedFiles.Contains(full))
                    {
                        try
                        {
                            File.Delete(full);
                            removed++;
                        }
                        catch
                        {
                            // Ignore transient lock on non-critical stale file
                        }
                    }
                }
                string[] subDirs = Directory.GetDirectories(dirPath);
                for (int i = 0; i < subDirs.Length; i++)
                {
                    string subFull = Path.GetFullPath(subDirs[i]);
                    if (!IsInsideRoot(subFull, rootFull) || IsReparsePoint(subFull))
                    {
                        continue;
                    }
                    removed += PruneObsoletePluginEntries(subFull, rootFull, expectedFiles, false);
                }
                if (!isRoot && Directory.GetFiles(dirPath).Length == 0 && Directory.GetDirectories(dirPath).Length == 0)
                {
                    try
                    {
                        Directory.Delete(dirPath, false);
                        removed++;
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }
            return removed;
        }

        public static string CheckDebugPortShortcutStatus()
        {
            try
            {
                List<string> searchRoots = new List<string>();
                string[] candidates = new string[]
                {
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms)
                };
                for (int i = 0; i < candidates.Length; i++)
                {
                    if (!string.IsNullOrEmpty(candidates[i]) && Directory.Exists(candidates[i]))
                    {
                        searchRoots.Add(candidates[i]);
                    }
                }

                int foundShortcuts = 0;
                int withDebugPort = 0;
                for (int r = 0; r < searchRoots.Count; r++)
                {
                    string[] links;
                    try
                    {
                        links = Directory.GetFiles(searchRoots[r], "*Antigravity*.lnk", SearchOption.AllDirectories);
                    }
                    catch
                    {
                        continue;
                    }
                    for (int k = 0; k < links.Length; k++)
                    {
                        foundShortcuts++;
                        try
                        {
                            byte[] raw = File.ReadAllBytes(links[k]);
                            string ascii = Encoding.ASCII.GetString(raw);
                            string utf16 = Encoding.Unicode.GetString(raw);
                            if (ascii.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0
                                || utf16.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                withDebugPort++;
                            }
                        }
                        catch
                        {
                        }
                    }
                }

                if (withDebugPort > 0)
                {
                    return string.Format("已检测到 {0}/{1} 个 Antigravity 快捷方式包含 --remote-debugging-port（支持自动重启后保留 Anti-Claude 扩展）", withDebugPort, foundShortcuts);
                }
                if (foundShortcuts > 0)
                {
                    return string.Format("检测到 {0} 个 Antigravity 快捷方式但未包含 --remote-debugging-port=0；若使用 Anti-Claude 扩展，建议通过 Anti-Claude 启动或补充该参数", foundShortcuts);
                }
                return "未在桌面/开始菜单扫描到 Antigravity 快捷方式（若通过 Anti-Claude 启动，切号自动重启时会自动保留调试端口参数）";
            }
            catch
            {
                return "快捷方式调试端口自检已跳过";
            }
        }

        public static bool UninstallPlugin(string rawPluginTargetDir, Action<string> log)
        {
            string targetDir = NormalizePrismFilesTarget(rawPluginTargetDir);
            if (!string.Equals(Path.GetFileName(targetDir), "prism-files", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安全拦截：拒绝删除非 prism-files 目录：" + targetDir);
            }

            if (Directory.Exists(targetDir))
            {
                Directory.Delete(targetDir, true);
                log(string.Format("[完成] 已干净移除插件目录: {0}（其余同级插件未受影响）", targetDir));
                return true;
            }
            log(string.Format("[跳过] 未发现插件目录: {0}", targetDir));
            return false;
        }

        public static WslDetectionResult DetectWslPluginTargets()
        {
            WslDetectionResult result = new WslDetectionResult();
            List<string> distros = ListWslDistrosWithTimeout(3000);
            result.DistrosChecked.AddRange(distros);

            HashSet<string> seenTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < distros.Count; i++)
            {
                string distro = distros[i];
                if (string.Equals(distro, "docker-desktop", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(distro, "docker-desktop-data", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                bool foundForDistro = false;
                string linuxHome = QueryWslHomeWithTimeout(distro, 3000);
                if (!string.IsNullOrEmpty(linuxHome))
                {
                    string relHome = linuxHome.Trim().TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string uncUserHome = ResolveWslUncPath(distro, relHome);
                    if (!string.IsNullOrEmpty(uncUserHome))
                    {
                        string target = TryBuildGeminiPluginTarget(uncUserHome);
                        if (!string.IsNullOrEmpty(target))
                        {
                            foundForDistro = true;
                            if (seenTargets.Add(target))
                            {
                                result.Targets.Add(target);
                            }
                        }
                    }
                }

                // Fallback: scan /home/* if $HOME query failed or did not point to an existing .gemini directory.
                if (!foundForDistro)
                {
                    string homeRoot = ResolveWslUncPath(distro, "home");
                    if (!string.IsNullOrEmpty(homeRoot))
                    {
                        try
                        {
                            string[] userDirs = Directory.GetDirectories(homeRoot);
                            for (int u = 0; u < userDirs.Length; u++)
                            {
                                string target = TryBuildGeminiPluginTarget(userDirs[u]);
                                if (!string.IsNullOrEmpty(target) && seenTargets.Add(target))
                                {
                                    result.Targets.Add(target);
                                }
                            }
                        }
                        catch
                        {
                            // Safely ignore inaccessible or stopped distro shares.
                        }
                    }
                }
            }

            if (result.Targets.Count > 0)
            {
                result.Summary = string.Format("已检测到 {0} 个 WSL 目标：{1}",
                    result.Targets.Count,
                    string.Join("；", result.Targets.ToArray()));
            }
            else if (distros.Count > 0)
            {
                result.Summary = string.Format("检测到 WSL 发行版（{0}），但未发现 ~/.gemini 目录（已跳过）",
                    string.Join(", ", distros.ToArray()));
            }
            else
            {
                result.Summary = "未检测到可用的 WSL 环境（仅安装至 Windows 本地目录）";
            }
            return result;
        }

        private static string TryBuildGeminiPluginTarget(string userHomeUnc)
        {
            try
            {
                string geminiDir = Path.Combine(userHomeUnc, ".gemini");
                string pluginsDir = Path.Combine(Path.Combine(geminiDir, "config"), "plugins");
                if (Directory.Exists(pluginsDir) || Directory.Exists(geminiDir))
                {
                    return Path.Combine(pluginsDir, "prism-files");
                }
            }
            catch
            {
                // Ignore transient UNC errors.
            }
            return null;
        }

        private static string ResolveWslUncPath(string distro, string relativeSubPath)
        {
            string[] prefixes = new string[]
            {
                @"\\wsl.localhost\" + distro,
                @"\\wsl$\" + distro
            };
            for (int i = 0; i < prefixes.Length; i++)
            {
                try
                {
                    string candidate = string.IsNullOrEmpty(relativeSubPath)
                        ? prefixes[i]
                        : Path.Combine(prefixes[i], relativeSubPath);
                    if (Directory.Exists(candidate))
                    {
                        return candidate;
                    }
                }
                catch
                {
                    // Try next UNC prefix.
                }
            }
            return null;
        }

        private static string QueryWslHomeWithTimeout(string distro, int timeoutMs)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "wsl.exe";
                psi.Arguments = string.Format("-d \"{0}\" -- sh -lc \"printf %s \\\"$HOME\\\"\"", distro.Replace("\"", string.Empty));
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;

                string raw = RunProcessAndReadStdout(psi, timeoutMs);
                if (string.IsNullOrEmpty(raw))
                {
                    return null;
                }
                string[] lines = raw.Replace("\uFEFF", string.Empty).Replace("\0", string.Empty)
                    .Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    string candidate = lines[i].Trim();
                    if (candidate.StartsWith("/", StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }
            }
            catch
            {
                // Safely ignore query failures and let fallback handle it.
            }
            return null;
        }

        private static List<string> ListWslDistrosWithTimeout(int timeoutMs)
        {
            List<string> distros = new List<string>();
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "wsl.exe";
                psi.Arguments = "-l -q";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.EnvironmentVariables.Remove("WSL_UTF8");
                psi.StandardOutputEncoding = Encoding.Unicode;

                string raw = RunProcessAndReadStdout(psi, timeoutMs);
                if (string.IsNullOrEmpty(raw))
                {
                    return distros;
                }

                string cleaned = raw.Replace("\uFEFF", string.Empty).Replace("\0", string.Empty);
                string[] lines = cleaned.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < lines.Length; i++)
                {
                    string name = lines[i].Trim();
                    if (name.Length > 0 && seen.Add(name))
                    {
                        distros.Add(name);
                    }
                }
            }
            catch
            {
                // WSL not installed or unavailable; safely ignore.
            }
            return distros;
        }

        private static string RunProcessAndReadStdout(ProcessStartInfo psi, int timeoutMs)
        {
            StringBuilder output = new StringBuilder();
            using (Process proc = new Process())
            {
                proc.StartInfo = psi;
                proc.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        lock (output)
                        {
                            output.AppendLine(e.Data);
                        }
                    }
                };
                proc.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { };

                if (!proc.Start())
                {
                    return null;
                }
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                if (!proc.WaitForExit(timeoutMs))
                {
                    try { proc.Kill(); } catch { }
                    return null;
                }
                proc.WaitForExit();
            }

            lock (output)
            {
                return output.ToString();
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private CheckBox chkExtensions;
        private CheckBox chkWinPlugin;
        private CheckBox chkWslPlugin;
        private Label lblWslStatus;
        private TextBox txtExtDir;
        private Button btnBrowseExt;
        private TextBox txtPluginDir;
        private Button btnBrowsePlugin;
        private Button btnInstall;
        private Button btnUninstall;
        private Label lblStatus;
        private TextBox txtLog;

        private readonly List<PayloadEntry> manifestEntries;
        private List<string> detectedWslTargets = new List<string>();
        private volatile bool isBusy;

        public MainForm(List<PayloadEntry> entries)
        {
            manifestEntries = entries;
            InitializeUi();
            Shown += OnFormShown;
        }

        private void InitializeUi()
        {
            Text = "Anti-Claude Prism Suite 一键安装器 v0.5.0";
            Size = new Size(740, 660);
            MinimumSize = new Size(660, 580);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(248, 250, 252);
            ForeColor = Color.FromArgb(15, 23, 42);
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);

            // Header banner
            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 84;
            header.BackColor = Color.FromArgb(15, 23, 42);
            header.Padding = new Padding(22, 16, 22, 14);
            header.Paint += PaintHeaderAccent;

            Label lblTitle = new Label();
            lblTitle.Text = "Anti-Claude Prism Suite 一键安装器  v0.5.0";
            lblTitle.ForeColor = Color.White;
            lblTitle.Font = new Font("Microsoft YaHei UI", 13.5f, FontStyle.Bold);
            lblTitle.AutoSize = true;
            lblTitle.Location = new Point(22, 15);

            Label lblSubtitle = new Label();
            lblSubtitle.Text = "一站式部署 Anti-Claude 棱镜扩展 与 Prism 工作台插件（文件 / 历史检索 / 多账号安全接力 · 原地热更保句柄）";
            lblSubtitle.ForeColor = Color.FromArgb(148, 163, 184);
            lblSubtitle.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular);
            lblSubtitle.AutoSize = true;
            lblSubtitle.Location = new Point(22, 48);

            header.Controls.Add(lblTitle);
            header.Controls.Add(lblSubtitle);

            // Main container
            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 1;
            root.RowCount = 4;
            root.Padding = new Padding(18, 14, 18, 16);
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));

            // Card 1: Components
            Panel cardComponents = CreateCardPanel();
            TableLayoutPanel compLayout = new TableLayoutPanel();
            compLayout.Dock = DockStyle.Top;
            compLayout.AutoSize = true;
            compLayout.ColumnCount = 1;
            compLayout.Padding = new Padding(14, 12, 14, 12);

            Label lblCompHeader = CreateSectionTitle("1. 选择安装 / 卸载组件");
            chkExtensions = new CheckBox();
            chkExtensions.Text = "安装 Anti-Claude 棱镜扩展套件（8套主题 / 大纲 / 12周热力图 / 水墨 / 像素伙伴 / 思考中译）";
            chkExtensions.Checked = true;
            chkExtensions.AutoSize = true;
            chkExtensions.Margin = new Padding(2, 6, 2, 4);

            chkWinPlugin = new CheckBox();
            chkWinPlugin.Text = "安装 Prism 工作台 MCP App 插件（文件树 / 键盘流 / 行号引用 / 历史检索 / 多账号接力）";
            chkWinPlugin.Checked = true;
            chkWinPlugin.AutoSize = true;
            chkWinPlugin.Margin = new Padding(2, 4, 2, 4);

            chkWslPlugin = new CheckBox();
            chkWslPlugin.Text = "同步安装至检测到的 WSL Antigravity 环境";
            chkWslPlugin.Checked = false;
            chkWslPlugin.Enabled = false;
            chkWslPlugin.AutoSize = true;
            chkWslPlugin.Margin = new Padding(2, 4, 2, 2);

            lblWslStatus = new Label();
            lblWslStatus.Text = "正在后台检测 WSL Antigravity 环境...";
            lblWslStatus.ForeColor = Color.FromArgb(100, 116, 139);
            lblWslStatus.Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular);
            lblWslStatus.AutoSize = true;
            lblWslStatus.MaximumSize = new Size(650, 0);
            lblWslStatus.Margin = new Padding(22, 0, 2, 2);

            compLayout.Controls.Add(lblCompHeader);
            compLayout.Controls.Add(chkExtensions);
            compLayout.Controls.Add(chkWinPlugin);
            compLayout.Controls.Add(chkWslPlugin);
            compLayout.Controls.Add(lblWslStatus);
            cardComponents.Controls.Add(compLayout);
            cardComponents.Margin = new Padding(0, 0, 0, 10);

            // Card 2: Paths
            Panel cardPaths = CreateCardPanel();
            TableLayoutPanel pathLayout = new TableLayoutPanel();
            pathLayout.Dock = DockStyle.Top;
            pathLayout.AutoSize = true;
            pathLayout.ColumnCount = 2;
            pathLayout.Padding = new Padding(14, 12, 14, 12);
            pathLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            pathLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            Label lblPathHeader = CreateSectionTitle("2. 目标目录配置");
            pathLayout.SetColumnSpan(lblPathHeader, 2);
            pathLayout.Controls.Add(lblPathHeader, 0, 0);

            Label lblExtDir = new Label();
            lblExtDir.Text = "Windows Anti-Claude 扩展目录：";
            lblExtDir.AutoSize = true;
            lblExtDir.ForeColor = Color.FromArgb(51, 65, 85);
            lblExtDir.Margin = new Padding(0, 6, 0, 2);
            pathLayout.SetColumnSpan(lblExtDir, 2);
            pathLayout.Controls.Add(lblExtDir, 0, 1);

            txtExtDir = new TextBox();
            txtExtDir.Text = InstallerCore.GetDefaultExtensionsDir();
            txtExtDir.Dock = DockStyle.Fill;
            txtExtDir.Margin = new Padding(0, 2, 8, 6);

            btnBrowseExt = new Button();
            btnBrowseExt.Text = "浏览...";
            btnBrowseExt.AutoSize = true;
            btnBrowseExt.Padding = new Padding(8, 2, 8, 2);
            btnBrowseExt.Margin = new Padding(0, 1, 0, 6);
            btnBrowseExt.Click += OnBrowseExtClick;

            pathLayout.Controls.Add(txtExtDir, 0, 2);
            pathLayout.Controls.Add(btnBrowseExt, 1, 2);

            Label lblPluginDir = new Label();
            lblPluginDir.Text = "Windows Antigravity 插件目录：";
            lblPluginDir.AutoSize = true;
            lblPluginDir.ForeColor = Color.FromArgb(51, 65, 85);
            lblPluginDir.Margin = new Padding(0, 4, 0, 2);
            pathLayout.SetColumnSpan(lblPluginDir, 2);
            pathLayout.Controls.Add(lblPluginDir, 0, 3);

            txtPluginDir = new TextBox();
            txtPluginDir.Text = InstallerCore.GetDefaultPluginDir();
            txtPluginDir.Dock = DockStyle.Fill;
            txtPluginDir.Margin = new Padding(0, 2, 8, 2);

            btnBrowsePlugin = new Button();
            btnBrowsePlugin.Text = "浏览...";
            btnBrowsePlugin.AutoSize = true;
            btnBrowsePlugin.Padding = new Padding(8, 2, 8, 2);
            btnBrowsePlugin.Margin = new Padding(0, 1, 0, 2);
            btnBrowsePlugin.Click += OnBrowsePluginClick;

            pathLayout.Controls.Add(txtPluginDir, 0, 4);
            pathLayout.Controls.Add(btnBrowsePlugin, 1, 4);

            cardPaths.Controls.Add(pathLayout);
            cardPaths.Margin = new Padding(0, 0, 0, 12);

            // Action bar
            TableLayoutPanel actionBar = new TableLayoutPanel();
            actionBar.Dock = DockStyle.Top;
            actionBar.AutoSize = true;
            actionBar.ColumnCount = 3;
            actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            actionBar.Margin = new Padding(0, 0, 0, 10);

            btnInstall = new Button();
            btnInstall.Text = "一键安装 / 更新";
            btnInstall.Size = new Size(168, 38);
            btnInstall.BackColor = Color.FromArgb(37, 99, 235);
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Font = new Font("Microsoft YaHei UI", 10f, FontStyle.Bold);
            btnInstall.Cursor = Cursors.Hand;
            btnInstall.Margin = new Padding(0, 0, 10, 0);
            btnInstall.Click += OnInstallClick;

            btnUninstall = new Button();
            btnUninstall.Text = "干净卸载";
            btnUninstall.Size = new Size(124, 38);
            btnUninstall.BackColor = Color.White;
            btnUninstall.ForeColor = Color.FromArgb(51, 65, 85);
            btnUninstall.FlatStyle = FlatStyle.Flat;
            btnUninstall.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
            btnUninstall.FlatAppearance.BorderSize = 1;
            btnUninstall.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);
            btnUninstall.Cursor = Cursors.Hand;
            btnUninstall.Margin = new Padding(0, 0, 12, 0);
            btnUninstall.Click += OnUninstallClick;

            lblStatus = new Label();
            lblStatus.Text = "就绪";
            lblStatus.ForeColor = Color.FromArgb(100, 116, 139);
            lblStatus.Dock = DockStyle.Fill;
            lblStatus.TextAlign = ContentAlignment.MiddleRight;

            actionBar.Controls.Add(btnInstall, 0, 0);
            actionBar.Controls.Add(btnUninstall, 1, 0);
            actionBar.Controls.Add(lblStatus, 2, 0);

            // Log area
            Panel logCard = CreateCardPanel();
            logCard.Dock = DockStyle.Fill;
            logCard.Padding = new Padding(12, 10, 12, 12);

            Label lblLogTitle = CreateSectionTitle("执行日志");
            lblLogTitle.Dock = DockStyle.Top;
            lblLogTitle.Padding = new Padding(0, 0, 0, 6);

            txtLog = new TextBox();
            txtLog.Dock = DockStyle.Fill;
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.WordWrap = true;
            txtLog.BorderStyle = BorderStyle.FixedSingle;
            txtLog.BackColor = Color.FromArgb(248, 250, 252);
            txtLog.ForeColor = Color.FromArgb(30, 41, 59);
            txtLog.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular);

            logCard.Controls.Add(txtLog);
            logCard.Controls.Add(lblLogTitle);

            root.Controls.Add(cardComponents, 0, 0);
            root.Controls.Add(cardPaths, 0, 1);
            root.Controls.Add(actionBar, 0, 2);
            root.Controls.Add(logCard, 0, 3);

            Controls.Add(root);
            Controls.Add(header);
        }

        private static void PaintHeaderAccent(object sender, PaintEventArgs e)
        {
            Panel p = sender as Panel;
            if (p == null) return;
            using (SolidBrush b = new SolidBrush(Color.FromArgb(37, 99, 235)))
            {
                e.Graphics.FillRectangle(b, 0, p.Height - 3, p.Width, 3);
            }
        }

        private static Panel CreateCardPanel()
        {
            Panel p = new Panel();
            p.Dock = DockStyle.Top;
            p.AutoSize = true;
            p.BackColor = Color.White;
            p.BorderStyle = BorderStyle.FixedSingle;
            return p;
        }

        private static Label CreateSectionTitle(string text)
        {
            Label lbl = new Label();
            lbl.Text = text;
            lbl.ForeColor = Color.FromArgb(15, 23, 42);
            lbl.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            lbl.AutoSize = true;
            lbl.Margin = new Padding(0, 0, 0, 4);
            return lbl;
        }

        private void OnFormShown(object sender, EventArgs e)
        {
            AppendLog(string.Format("已载入内嵌资源清单：共 {0} 个文件。", manifestEntries.Count));
            AppendLog("正在检测 WSL Antigravity 环境（最多等待 3 秒）...");

            ThreadPool.QueueUserWorkItem(delegate
            {
                WslDetectionResult wsl = InstallerCore.DetectWslPluginTargets();
                string shortcutNote = InstallerCore.CheckDebugPortShortcutStatus();
                if (!IsDisposed)
                {
                    try
                    {
                        BeginInvoke((MethodInvoker)delegate
                        {
                            detectedWslTargets = wsl.Targets;
                            lblWslStatus.Text = wsl.Summary;
                            if (detectedWslTargets.Count > 0)
                            {
                                chkWslPlugin.Enabled = true;
                                chkWslPlugin.Checked = true;
                                lblWslStatus.ForeColor = Color.FromArgb(21, 128, 61);
                                AppendLog("[检测] " + wsl.Summary);
                            }
                            else
                            {
                                chkWslPlugin.Enabled = false;
                                chkWslPlugin.Checked = false;
                                lblWslStatus.ForeColor = Color.FromArgb(100, 116, 139);
                                AppendLog("[检测] " + wsl.Summary);
                            }
                            AppendLog("[自检] " + shortcutNote);
                        });
                    }
                    catch
                    {
                        // Window already closed.
                    }
                }
            });
        }

        private void OnBrowseExtClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择 Anti-Claude user\\extensions 目录";
                dlg.SelectedPath = txtExtDir.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath))
                {
                    txtExtDir.Text = dlg.SelectedPath;
                }
            }
        }

        private void OnBrowsePluginClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择 Antigravity 插件目录（将安装至 prism-files 子目录）";
                dlg.SelectedPath = txtPluginDir.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath))
                {
                    txtPluginDir.Text = InstallerCore.NormalizePrismFilesTarget(dlg.SelectedPath);
                }
            }
        }

        private void OnInstallClick(object sender, EventArgs e)
        {
            RunOperation(true);
        }

        private void OnUninstallClick(object sender, EventArgs e)
        {
            if (isBusy) return;

            bool doExt = chkExtensions.Checked;
            bool doWinPlugin = chkWinPlugin.Checked;
            bool doWsl = chkWslPlugin.Enabled && chkWslPlugin.Checked && detectedWslTargets.Count > 0;
            if (!doExt && !doWinPlugin && !doWsl)
            {
                MessageBox.Show(this, "请至少勾选一个需要卸载的组件。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            DialogResult confirm = MessageBox.Show(
                this,
                "确定要干净卸载已勾选的 Anti-Claude Prism Suite 组件吗？\n\n仅移除 6 个扩展文件（prism-suite*.{css,js}：prism-suite.css / prism-suite.js / prism-suite-fx.css / prism-suite-fx.js / prism-suite-workflow.css / prism-suite-workflow.js）与 prism-files 插件目录，绝不会影响您的其他扩展、插件或会话数据。",
                "确认干净卸载",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes)
            {
                return;
            }

            RunOperation(false);
        }

        private void RunOperation(bool isInstall)
        {
            if (isBusy) return;

            bool doExt = chkExtensions.Checked;
            bool doWinPlugin = chkWinPlugin.Checked;
            bool doWsl = chkWslPlugin.Enabled && chkWslPlugin.Checked && detectedWslTargets.Count > 0;

            if (!doExt && !doWinPlugin && !doWsl)
            {
                MessageBox.Show(this, "请至少勾选一个组件。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string extDir = txtExtDir.Text;
            string winPluginDir = txtPluginDir.Text;
            List<string> wslTargetsSnapshot = new List<string>(detectedWslTargets);

            SetBusyState(true, isInstall ? "正在安装..." : "正在卸载...");
            AppendLog(isInstall ? "=== 开始一键安装 / 更新 ===" : "=== 开始干净卸载 ===");

            Thread worker = new Thread(delegate()
            {
                string errorMessage = null;
                try
                {
                    Action<string> uiLog = delegate(string msg)
                    {
                        SafeInvoke(delegate { AppendLog(msg); });
                    };

                    if (isInstall)
                    {
                        if (doExt)
                        {
                            InstallerCore.InstallExtensions(extDir, manifestEntries, uiLog);
                        }
                        if (doWinPlugin)
                        {
                            InstallerCore.InstallPlugin(winPluginDir, manifestEntries, uiLog);
                        }
                        if (doWsl)
                        {
                            for (int i = 0; i < wslTargetsSnapshot.Count; i++)
                            {
                                InstallerCore.InstallPlugin(wslTargetsSnapshot[i], manifestEntries, uiLog);
                            }
                        }
                    }
                    else
                    {
                        if (doExt)
                        {
                            InstallerCore.UninstallExtensions(extDir, uiLog);
                        }
                        if (doWinPlugin)
                        {
                            InstallerCore.UninstallPlugin(winPluginDir, uiLog);
                        }
                        if (doWsl)
                        {
                            for (int i = 0; i < wslTargetsSnapshot.Count; i++)
                            {
                                InstallerCore.UninstallPlugin(wslTargetsSnapshot[i], uiLog);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    errorMessage = ex.Message;
                }

                SafeInvoke(delegate
                {
                    SetBusyState(false, errorMessage == null ? "已完成" : "发生错误");
                    if (errorMessage != null)
                    {
                        AppendLog("[错误] " + errorMessage);
                        MessageBox.Show(this, "操作失败：\n" + errorMessage, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                    else
                    {
                        AppendLog(isInstall
                            ? "=== 全部安装已完成！请刷新 Anti-Claude / 重载 Antigravity 使插件生效 ==="
                            : "=== 干净卸载已完成 ===");
                        MessageBox.Show(
                            this,
                            isInstall
                                ? "Anti-Claude Prism Suite 安装 / 更新成功！\n\n若 Anti-Claude 或 Antigravity 正在运行，请刷新页面或重载应用以启用最新组件。"
                                : "已干净卸载选中的 Anti-Claude Prism Suite 组件。",
                            isInstall ? "安装成功" : "卸载完成",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void SetBusyState(bool busy, string statusText)
        {
            isBusy = busy;
            btnInstall.Enabled = !busy;
            btnUninstall.Enabled = !busy;
            btnBrowseExt.Enabled = !busy;
            btnBrowsePlugin.Enabled = !busy;
            txtExtDir.Enabled = !busy;
            txtPluginDir.Enabled = !busy;
            chkExtensions.Enabled = !busy;
            chkWinPlugin.Enabled = !busy;
            chkWslPlugin.Enabled = !busy && detectedWslTargets.Count > 0;
            lblStatus.Text = statusText;
        }

        private void SafeInvoke(MethodInvoker action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(action);
                }
                else
                {
                    action();
                }
            }
            catch
            {
                // Ignore if form disposed during shutdown.
            }
        }

        private void AppendLog(string message)
        {
            string line = string.Format("[{0}] {1}", DateTime.Now.ToString("HH:mm:ss"), message);
            if (txtLog.TextLength > 0)
            {
                txtLog.AppendText(Environment.NewLine);
            }
            txtLog.AppendText(line);
        }
    }

    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                SetProcessDPIAware();
            }
            catch
            {
                // Ignore on unsupported environments.
            }

            CliOptions opts = ParseArgs(args);
            if (opts.SilentInstall || opts.SilentUninstall)
            {
                return RunSilent(opts);
            }

            List<PayloadEntry> entries;
            try
            {
                entries = InstallerCore.LoadManifest();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "无法加载安装程序内置资源：\n" + ex.Message,
                    "Anti-Claude Prism Suite 安装器",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(entries));
            return 0;
        }

        private static CliOptions ParseArgs(string[] args)
        {
            CliOptions opts = new CliOptions();
            if (args == null) return opts;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--silent-install", StringComparison.OrdinalIgnoreCase))
                {
                    opts.SilentInstall = true;
                }
                else if (string.Equals(a, "--silent-uninstall", StringComparison.OrdinalIgnoreCase))
                {
                    opts.SilentUninstall = true;
                }
                else if (string.Equals(a, "--no-wsl", StringComparison.OrdinalIgnoreCase))
                {
                    opts.NoWsl = true;
                }
                else if (a.StartsWith("--test-user-dir=", StringComparison.OrdinalIgnoreCase))
                {
                    opts.TestUserDir = a.Substring("--test-user-dir=".Length);
                }
                else if (string.Equals(a, "--test-user-dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.TestUserDir = args[++i];
                }
                else if (a.StartsWith("--test-plugins-dir=", StringComparison.OrdinalIgnoreCase))
                {
                    opts.TestPluginsDir = a.Substring("--test-plugins-dir=".Length);
                }
                else if (string.Equals(a, "--test-plugins-dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.TestPluginsDir = args[++i];
                }
            }
            return opts;
        }

        private static int RunSilent(CliOptions opts)
        {
            if (opts.SilentInstall && opts.SilentUninstall)
            {
                Console.Error.WriteLine("Cannot combine --silent-install and --silent-uninstall.");
                return 1;
            }

            try
            {
                List<PayloadEntry> entries = InstallerCore.LoadManifest();
                Action<string> consoleLog = delegate(string msg) { Console.WriteLine(msg); };

                bool isTestMode = !string.IsNullOrEmpty(opts.TestUserDir) || !string.IsNullOrEmpty(opts.TestPluginsDir);
                if (isTestMode)
                {
                    if (!string.IsNullOrEmpty(opts.TestUserDir))
                    {
                        string extTarget = Path.Combine(Path.GetFullPath(opts.TestUserDir), "extensions");
                        if (opts.SilentInstall)
                        {
                            InstallerCore.InstallExtensions(extTarget, entries, consoleLog);
                        }
                        else
                        {
                            InstallerCore.UninstallExtensions(extTarget, consoleLog);
                        }
                    }

                    if (!string.IsNullOrEmpty(opts.TestPluginsDir))
                    {
                        string pluginTarget = InstallerCore.NormalizePrismFilesTarget(opts.TestPluginsDir);
                        if (opts.SilentInstall)
                        {
                            InstallerCore.InstallPlugin(pluginTarget, entries, consoleLog);
                        }
                        else
                        {
                            InstallerCore.UninstallPlugin(pluginTarget, consoleLog);
                        }
                    }
                    return 0;
                }

                string defaultExt = InstallerCore.GetDefaultExtensionsDir();
                string defaultPlugin = InstallerCore.GetDefaultPluginDir();

                if (opts.SilentInstall)
                {
                    InstallerCore.InstallExtensions(defaultExt, entries, consoleLog);
                    InstallerCore.InstallPlugin(defaultPlugin, entries, consoleLog);
                    if (!opts.NoWsl)
                    {
                        WslDetectionResult wsl = InstallerCore.DetectWslPluginTargets();
                        consoleLog("[WSL] " + wsl.Summary);
                        for (int i = 0; i < wsl.Targets.Count; i++)
                        {
                            InstallerCore.InstallPlugin(wsl.Targets[i], entries, consoleLog);
                        }
                    }
                }
                else
                {
                    InstallerCore.UninstallExtensions(defaultExt, consoleLog);
                    InstallerCore.UninstallPlugin(defaultPlugin, consoleLog);
                    if (!opts.NoWsl)
                    {
                        WslDetectionResult wsl = InstallerCore.DetectWslPluginTargets();
                        consoleLog("[WSL] " + wsl.Summary);
                        for (int i = 0; i < wsl.Targets.Count; i++)
                        {
                            InstallerCore.UninstallPlugin(wsl.Targets[i], consoleLog);
                        }
                    }
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[Error] " + ex.Message);
                return 1;
            }
        }
    }
}
