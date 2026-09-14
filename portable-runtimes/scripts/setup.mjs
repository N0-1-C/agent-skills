#!/usr/bin/env node
/**
 * portable-runtimes / scripts/setup.mjs
 *
 * 把本技能内置的 Node / Python / Git 免安装包，解压成一个开箱即用的便携运行时目录。
 *
 * 设计原则：不写注册表、不改系统 PATH、不装系统服务、不需要管理员权限。
 * 目标目录删掉 = 彻底卸载，不留残留。
 *
 * 零依赖，只用 Node 内置模块；解压依赖 Windows 自带的 tar.exe（bsdtar，Win10 1803+ 自带）。
 *
 * 用法：
 *   node scripts/setup.mjs                    # 全装，默认解压到 %USERPROFILE%\portable-runtime
 *   node scripts/setup.mjs --target D:\tools  # 指定目标目录
 *   node scripts/setup.mjs --node lts         # lts(默认) | current | both | none
 *   node scripts/setup.mjs --only python,git  # 只装部分
 *   node scripts/setup.mjs --pip              # 顺带把嵌入式 Python 的 pip 装好（需要能访问 pypi）
 *   node scripts/setup.mjs --check            # 只校验内置包的 SHA-256，不解压
 *   node scripts/setup.mjs --list             # 列出内置包
 *   node scripts/setup.mjs --env              # 只打印可直接粘贴的 PATH 片段
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const PKG_DIR = path.join(SKILL_DIR, 'packages');
const TOOL_DIR = path.join(SKILL_DIR, 'tools');

// ---------------------------------------------------------------- 内置包清单
// dir:   解压到 <target>/<dir>；null 表示解压到 <target> 本身（zip 自带顶层目录时用）
// bins:  相对于 <target>/<dir> 的 bin 子目录，会被拼进 PATH 片段
const PACKAGES = [
  {
    id: 'git',
    file: 'PortableGit-2.55.0.5-64-bit.7z.exe',
    kind: 'sfx7z',
    dir: 'PortableGit-2.55.0.5-64-bit',
    title: 'Git for Windows 2.55.0.5（便携版，含 Git Bash）',
    bins: ['cmd', 'bin', 'usr\\bin'],
    probe: ['cmd/git.exe', ['--version']],
  },
  {
    id: 'python',
    file: 'python-3.14.7-embed-amd64.zip',
    kind: 'zip',
    dir: 'python-3.14.7-embed-amd64',
    title: 'Python 3.14.7（官方 embeddable，免安装）',
    bins: ['.', 'Scripts'],
    probe: ['python.exe', ['-V']],
  },
  {
    id: 'node-lts',
    file: 'node-v24.21.0-win-x64.zip',
    kind: 'zip',
    dir: null,
    title: 'Node.js 24.21.0 LTS（长期支持，推荐）',
    bins: ['.'],
    probe: ['node.exe', ['-v']],
  },
  {
    id: 'node-current',
    file: 'node-v26.8.2-win-x64.zip',
    kind: 'zip',
    dir: null,
    title: 'Node.js 26.8.2 Current（最新特性）',
    bins: ['.'],
    probe: ['node.exe', ['-v']],
  },
];

// 解压后落在 target 下的目录名（node 的 zip 自带顶层目录，用 zip 名反推）
function installDir(p, target) {
  if (p.dir) return path.join(target, p.dir);
  return path.join(target, p.file.replace(/\.zip$/i, ''));
}

// 解压时 -C 的落点：
//   自带顶层目录的 zip（node）→ 直接解到 target，让 zip 里的目录自己展开；
//   不带顶层目录的包（python / git）→ 解到一个以包名命名的子目录。
function extractRoot(p, target) {
  return p.dir ? path.join(target, p.dir) : target;
}

// ---------------------------------------------------------------- 小工具
const C = {
  ok: s => `\x1b[32m${s}\x1b[0m`,
  bad: s => `\x1b[31m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[90m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`,
};

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function readSums() {
  const f = path.join(PKG_DIR, 'SHA256SUMS.txt');
  const map = new Map();
  if (!fs.existsSync(f)) return map;
  const txt = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([0-9a-f]{64})\s+(\S.*)$/i);
    if (m) map.set(m[2].trim(), m[1].toLowerCase());
  }
  return map;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
    p.on('error', reject);
    p.on('exit', c => (c === 0 ? resolve(0) : reject(new Error(`${path.basename(cmd)} 退出码 ${c}`))));
  });
}

function capture(cmd, args) {
  return new Promise(resolve => {
    let out = '';
    const p = spawn(cmd, args, { windowsHide: true });
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (out += d));
    p.on('error', () => resolve(null));
    p.on('exit', () => resolve(out.trim()));
  });
}

const SIZE = b => (b / 1048576).toFixed(1) + ' MB';

// ---------------------------------------------------------------- 参数
function parseArgs(argv) {
  const o = { target: path.join(os.homedir(), 'portable-runtime'), node: 'lts', only: null, pip: false, check: false, list: false, env: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') o.target = path.resolve(argv[++i]);
    else if (a === '--node') o.node = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--pip') o.pip = true;
    else if (a === '--check') o.check = true;
    else if (a === '--list') o.list = true;
    else if (a === '--env') o.env = true;
    else if (a === '--force') o.force = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else { console.error(`未知参数：${a}`); o.help = true; }
  }
  return o;
}

function help() {
  console.log(`
${C.b('portable-runtimes · setup')} —— 把内置的 Node / Python / Git 解压成便携运行时

  node scripts/setup.mjs [选项]

  --target <目录>     解压目标（默认 %USERPROFILE%\\portable-runtime）
  --node <lts|current|both|none>   Node 版本，默认 lts
  --only <a,b>        只装指定项（git / python / node-lts / node-current）
  --pip               解压后自动为嵌入式 Python 安装 pip（需要能访问 pypi.org）
  --check             只校验内置包的 SHA-256，不解压
  --list              列出内置包
  --env               只打印 PATH 片段（不写文件、不改系统变量）
  --force             目标已存在时也重新解压

全程不写注册表、不改系统 PATH、不需要管理员权限。删掉目标目录 = 彻底卸载。
`);
}

function selectPackages(o) {
  let ids = PACKAGES.map(p => p.id);
  if (o.only) ids = ids.filter(id => o.only.includes(id));
  ids = ids.filter(id => {
    if (id === 'node-lts') return o.node === 'lts' || o.node === 'both';
    if (id === 'node-current') return o.node === 'current' || o.node === 'both';
    return true;
  });
  return PACKAGES.filter(p => ids.includes(p.id));
}

// ---------------------------------------------------------------- SHA-256 校验
function verify(list) {
  const sums = readSums();
  const bad = [];
  for (const p of list) {
    const f = path.join(PKG_DIR, p.file);
    if (!fs.existsSync(f)) { console.log(`  ${C.bad('缺失')} ${p.file}`); bad.push(p.file); continue; }
    const actual = sha256(f);
    const want = sums.get(p.file);
    const sz = SIZE(fs.statSync(f).size);
    if (!want) {
      console.log(`  ${C.warn('未列入')} ${p.file}  ${sz}  sha256=${actual}`);
    } else if (want === actual) {
      console.log(`  ${C.ok('OK  ')} ${p.file}  ${sz}  sha256=${actual}`);
    } else {
      console.log(`  ${C.bad('不一致')} ${p.file}  ${sz}`);
      console.log(`        期望 ${want}`);
      console.log(`        实际 ${actual}`);
      bad.push(p.file);
    }
  }
  return bad;
}

// ---------------------------------------------------------------- 解压
async function extract(p, target, force) {
  const dest = installDir(p, target);
  const root = extractRoot(p, target);
  if (fs.existsSync(dest) && !force) return { dest, skipped: true };
  fs.mkdirSync(root, { recursive: true });

  if (p.kind === 'zip') {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (!fs.existsSync(tar)) throw new Error('找不到 Windows 自带的 tar.exe（需要 Win10 1803 及以上）');
    await run(tar, ['-xf', path.join(PKG_DIR, p.file), '-C', root]);
  } else if (p.kind === 'sfx7z') {
    // 7-Zip 自解压包：-o 必须紧贴路径、不能有空格
    await run(path.join(PKG_DIR, p.file), ['-y', '-o' + root], { stdio: 'ignore' });
  }
  return { dest, skipped: false };
}

// ---------------------------------------------------------------- Python 特殊处理
function patchPython(dir) {
  const pth = fs.readdirSync(dir).find(f => /^python\d+\._pth$/i.test(f));
  if (!pth) return false;
  const f = path.join(dir, pth);
  const before = fs.readFileSync(f, 'utf8');
  let after = before;
  if (/^\s*#\s*import site\s*$/m.test(after)) after = after.replace(/^\s*#\s*import site\s*$/m, 'import site');
  else if (!/^\s*import site\s*$/m.test(after)) after += '\nimport site\n';
  if (!/Lib\\site-packages/.test(after)) after = after.replace(/^import site\s*$/m, 'import site\nLib\\site-packages');
  if (after !== before) fs.writeFileSync(f, after, 'utf8');
  return true;
}

// ---------------------------------------------------------------- PATH 片段
function envLines(target, list) {
  const entries = [];
  for (const p of list) {
    const d = installDir(p, target);
    for (const b of p.bins || []) entries.push(path.join(d, b));
  }
  // 越靠前优先级越高：node、python、git 顺序无所谓，互不冲突
  const uniq = [...new Set(entries)];
  return {
    entries: uniq,
    ps: `$env:PATH = "${uniq.join(';')};" + $env:PATH`,
    cmd: `set "PATH=${uniq.join(';')};%PATH%"`,
    sh: `export PATH="${uniq.map(e => e.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase())).join(':')}:$PATH"`,
  };
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return help();

  const list = selectPackages(o);

  if (o.list) {
    console.log(`\n${C.b('内置包')}（位于 ${PKG_DIR}）\n`);
    const sums = readSums();
    for (const p of PACKAGES) {
      const f = path.join(PKG_DIR, p.file);
      const has = fs.existsSync(f);
      console.log(`  ${C.b(p.id.padEnd(13))} ${p.title}`);
      console.log(`  ${' '.repeat(13)} ${p.file}${has ? '  ' + SIZE(fs.statSync(f).size) : C.bad('  (文件缺失)')}`);
      if (has && sums.has(p.file)) console.log(`  ${' '.repeat(13)} ${C.dim('sha256 ' + sums.get(p.file))}`);
      console.log();
    }
    return;
  }

  if (o.check) {
    console.log(`\n${C.b('校验内置包 SHA-256')}\n`);
    const bad = verify(PACKAGES);
    console.log();
    if (bad.length) { console.log(C.bad(`✗ ${bad.length} 个包校验不通过：${bad.join(', ')}`)); process.exit(1); }
    console.log(C.ok('✓ 全部通过'));
    return;
  }

  if (o.env) {
    const e = envLines(o.target, list);
    console.log(`\n${C.b('PATH 片段')}  目标目录 ${o.target}\n`);
    console.log(C.dim('# PowerShell（当前窗口有效）'));
    console.log(e.ps + '\n');
    console.log(C.dim('# cmd'));
    console.log(e.cmd + '\n');
    console.log(C.dim('# Git Bash / WSL'));
    console.log(e.sh + '\n');
    return;
  }

  console.log(`\n${C.b('portable-runtimes · 安装')}`);
  console.log(C.dim(`  技能目录  ${SKILL_DIR}`));
  console.log(C.dim(`  目标目录  ${o.target}`));

  // 长路径提醒：PortableGit 内部路径很深
  if (o.target.length > 60) {
    console.log(C.warn(`\n  ⚠ 目标目录路径较长（${o.target.length} 字符）。PortableGit 内部有很深的目录，`));
    console.log(C.warn(`    建议换一个更短的路径，例如 D:\\tools，否则可能触发 Windows 260 字符路径上限。`));
  }

  console.log(`\n${C.b('1/4 校验内置包')}`);
  const bad = verify(list);
  if (bad.length) {
    console.log(C.bad(`\n✗ 校验失败：${bad.join(', ')}。包可能损坏，请重新获取后再试。`));
    process.exit(1);
  }

  console.log(`\n${C.b('2/4 解压')}`);
  fs.mkdirSync(o.target, { recursive: true });
  for (const p of list) {
    process.stdout.write(`  ${p.id.padEnd(13)} → ${installDir(p, o.target)}  `);
    try {
      const r = await extract(p, o.target, o.force);
      console.log(r.skipped ? C.dim('已存在，跳过（要重来加 --force）') : C.ok('完成'));
    } catch (e) {
      console.log(C.bad('失败：' + e.message));
      process.exit(1);
    }
  }

  console.log(`\n${C.b('3/4 收尾')}`);
  const py = list.find(p => p.id === 'python');
  let pyDir = null;
  if (py) {
    pyDir = installDir(py, o.target);
    const ok = patchPython(pyDir);
    console.log(`  python._pth  ${ok ? C.ok('已启用 site（这样才能装第三方库）') : C.warn('没找到 ._pth，跳过')}`);
    fs.mkdirSync(path.join(pyDir, 'Lib', 'site-packages'), { recursive: true });
  }
  if (o.pip && pyDir) {
    const gp = path.join(TOOL_DIR, 'get-pip.py');
    if (!fs.existsSync(gp)) console.log(`  ${C.warn('tools/get-pip.py 缺失，跳过 pip')}`);
    else {
      process.stdout.write('  安装 pip     ');
      try {
        await run(path.join(pyDir, 'python.exe'), [gp, '--no-warn-script-location'], { stdio: 'ignore' });
        const v = await capture(path.join(pyDir, 'python.exe'), ['-m', 'pip', '--version']);
        console.log(C.ok('完成') + (v ? '  ' + v.split('\n')[0] : ''));
      } catch (e) {
        console.log(C.bad('失败：' + e.message));
        console.log(C.dim('     （装 pip 需要访问 pypi.org，国内可先让命令走代理再重试）'));
      }
    }
  } else if (pyDir) {
    console.log(C.dim('  提示：加了 --pip 就能顺带把 pip 装好'));
  }

  console.log(`\n${C.b('4/4 冒烟测试')}`);
  for (const p of list) {
    const d = installDir(p, o.target);
    const exe = path.join(d, p.probe[0]);
    const args = p.probe[1];
    const out = fs.existsSync(exe) ? await capture(exe, args) : null;
    if (out) console.log(`  ${C.ok('OK  ')} ${p.id.padEnd(13)} ${out.split('\n')[0]}`);
    else console.log(`  ${C.bad('FAIL')} ${p.id.padEnd(13)} ${exe} 跑不起来`);
  }

  const e = envLines(o.target, list);
  console.log(`\n${C.b('用法')}`);
  console.log('  什么都不用装到系统里。要用的时候，在窗口里先执行下面这句，之后 node / python / git 就能直接用了：\n');
  console.log('  ' + C.dim('# PowerShell（只在当前窗口生效，关掉即失效）'));
  console.log('  ' + e.ps);
  console.log('\n  ' + C.dim('# cmd'));
  console.log('  ' + e.cmd);
  console.log(`\n  ${C.dim('Git Bash 图形终端：')} ${path.join(installDir(PACKAGES[0], o.target), 'git-bash.exe')}`);
  console.log(`\n${C.ok('✓ 完成')}  删除 ${o.target} 即可彻底卸载，系统里没留任何东西。\n`);
}

main().catch(e => { console.error(C.bad('FATAL: ' + e.message)); process.exit(1); });
