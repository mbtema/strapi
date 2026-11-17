#!/usr/bin/env node
// Перенос файлов Product localizer с Desktop без удаления и перезаписи.
import {readdir,lstat,mkdir,rename,writeFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const desktop=process.argv[2];
if(!desktop)throw Error('Передайте путь Desktop первым аргументом');
const root=resolve(desktop), destination=join(root,'Product-Localizer');
async function exists(path) {
  try {await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
const locks=[];
try {
  await mkdir(destination,{recursive:true});
  for(const dir of [root,destination]) {
    const names=await readdir(dir);
    if(names.some(n=>/^product-kk.*\.lock$/.test(n)))
      throw Error('Есть lock localizer в '+dir+'. Дождитесь завершения процесса.');
  }
  // Оба места блокируются на время переноса, включая обычный audit.
  for(const dir of [root,destination])for(const name of ['product-kk-apply.lock','product-kk-audit.lock']) {
    const p=join(dir,name);await writeFile(p,String(process.pid),{flag:'wx'});locks.push(p);
  }
  const moves=[];
  for(const name of await readdir(root)) {
    if(name==='localizer.mjs'||(name.startsWith('product-kk-')&&!name.endsWith('.lock'))) {
      const source=join(root,name);
      if((await lstat(source)).isSymbolicLink())throw Error('Не переносим ссылку: '+source);
      // Рабочие backup и checkpoint остаются рядом со скриптом.
      const target=name.startsWith('product-kk-recovery-')?
        join(destination,'runs','previous',name):join(destination,name);
      moves.push({source,target});
    }
  }
  // Проверяем ВСЕ конфликты до первого перемещения. Папки не объединяются.
  for(const {target} of moves)if(await exists(target))throw Error('Уже существует: '+target+'. Ничего не перезаписано.');
  await mkdir(join(destination,'runs','previous'),{recursive:true});
  for(const {source,target} of moves) {
    await rename(source,target);
    console.log('Перенесено:',source,'→',target);
  }
  console.log('Готово. Рабочая папка:',destination);
  console.log('JWT остался на Desktop. Новые команды запускайте для Product-Localizer/localizer.mjs.');
} catch(e) {
  console.error('Перенос остановлен:',e.message);
  console.error('Файлы не удаляются. После устранения причины повторите команду; уже перенесённые файлы сохранятся.');
  process.exitCode=1;
} finally {
  for(const p of locks.reverse())await unlink(p).catch(e=>{console.error('Не удалось снять lock:',p,e.message);process.exitCode=1;});
}
