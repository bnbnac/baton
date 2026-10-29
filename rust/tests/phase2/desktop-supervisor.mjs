// A detached Node host escapes libuv's parent-owned kill-on-close job on Windows.
// PowerShell itself does not execute scripts in our detached/no-console setup;
// start it normally in this independent host and retain its exit status.
import {spawn} from 'node:child_process';
const child=spawn('pwsh',['-NoProfile','-NonInteractive',...process.argv.slice(2)],{windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
