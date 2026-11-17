const fs=require('node:fs/promises');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
(async()=>{
const source=(await fs.readFile(path.join(__dirname,'localizer.mjs'),'utf8')).replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url','"file:///tmp/recovery-test/localizer.mjs"').replace(/main\(\)\.catch\([\s\S]*$/,'');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'localizer-recovery-'));
let checks=0;
async function setup(apply=false){
 const root=await fs.mkdtemp(path.join(dir,'case-'));
 const context=vm.createContext({...fs,join:path.join,dirname:()=>root,fileURLToPath:()=>'',env:{},argv:['node','localizer.mjs','--recover-pending','--self-test',...(apply?['--apply']:[])],pid:process.pid,homedir:()=>root,execFile(){},promisify:()=>{},createHash,process:{on(){},exitCode:0},console:{log(){}},setTimeout});
 vm.runInContext(source,context);
 return {root,c:context,run:x=>vm.runInContext(x,context)};
}
const v=(locale,rows)=>({data:{key:'stable-key'},fields:{name:'Product',name1:'Translation'},relations:{categories:rows.map((documentId,id)=>({documentId,id:id+1,locale}))}});
const sample={documentId:'aaaaaaaaaaaaaaaaaaaaaaaa',phase:'save-kk',before:{
 ru:v('ru',['new']),ruPublished:v('ru',['new']),kk:v('kk',['old']),published:v('kk',['old'])},
 plan:{changes:[{kind:'relation',field:'categories',target:'api::category.category',add:['new'],remove:['old']}],blockers:[]}};
{
 const {c,run}=await setup();c.b=structuredClone(sample);
 run('relationFields=["categories"];live={ru:JSON.parse(JSON.stringify(b.before.ru)),ruPublished:JSON.parse(JSON.stringify(b.before.ruPublished)),kk:JSON.parse(JSON.stringify(b.before.kk)),pub:JSON.parse(JSON.stringify(b.before.published))}');
 assert.equal(run('recoveryDecision(b,live)'),'save');
 run('live.ru.relations.categories[0].id=999');
 assert.equal(run('recoveryDecision(b,live)'),'save');
 run('live.ruPublished.data.key="changed"');
 assert.equal(run('recoveryDecision(b,live)'),'ru_changed');
 run('live.ruPublished.data.key=b.before.ruPublished.data.key;live.pub.fields.name="external"');
 assert.equal(run('recoveryDecision(b,live)'),'published_changed');
 run('live.pub=JSON.parse(JSON.stringify(b.before.published));live.kk.data.key="other"');
 assert.equal(run('recoveryDecision(b,live)'),'kk_key_or_version_changed');
 checks+=5;
}
for(const scenario of ['dry','save','publish','complete','ru_changed','partial','key','http500','schema']){
 const {root,c,run}=await setup(scenario!=='dry');c.b=structuredClone(sample);c.calls=[];
 await fs.mkdir(path.join(root,'product-kk-backups'));
 await fs.writeFile(path.join(root,'product-kk-backups',sample.documentId+'.json'),JSON.stringify(sample));
 await fs.writeFile(path.join(root,'product-kk-apply-schema.sha256'),scenario==='schema'?'wrong':'test');
 await fs.writeFile(path.join(root,'product-kk-apply-progress.jsonl'),JSON.stringify({id:sample.documentId,status:'error_pending_backup',reason:scenario==='key'?'key must be unique':'PUT HTTP 500'})+'\n');
 run(`relationFields=Object.keys(b.before.kk.relations);
 live={ru:b.before.ru,ruPublished:b.before.ruPublished,kk:JSON.parse(JSON.stringify(b.before.kk)),pub:JSON.parse(JSON.stringify(b.before.published))};
 plan=(ru,k,p)=>({changes:relEqual(k,{relations:b.before.kk.relations})?b.plan.changes:[],blockers:[]});
 recoveryVersions=async()=>JSON.parse(JSON.stringify(live));
 dependencyCheck=async()=>[];
 recheckBeforeWrite=async()=>{};
 nativeWriteRelationPreflight=async(id,a)=>a;
 payloadForSave=()=>({locale:'kk'});
 publishPayload=()=>({locale:'kk'});
 postflight=async()=>live;
 http=async(method)=>{calls.push(method);if(method==='PUT')live.kk={...live.kk,...expectedDraft({ru:b.before.ru,kk:b.before.kk},b.plan.changes)};else live.pub=JSON.parse(JSON.stringify(live.kk));};`);
 if(['publish','complete'].includes(scenario))run('live.kk={...live.kk,...expectedDraft({ru:b.before.ru,kk:b.before.kk},b.plan.changes)}');
 if(scenario==='complete')run('live.pub=JSON.parse(JSON.stringify(live.kk))');
 if(scenario==='ru_changed')run('live.ru=JSON.parse(JSON.stringify(live.ru));live.ru.fields.name="changed"');
 if(scenario==='partial')run('live.kk.fields.name="changed"');
 if(scenario==='http500')run('http=async(method)=>{calls.push(method);throw Error("PUT HTTP 500");}');
 if(scenario==='schema')await assert.rejects(run('recoverPending("test")'),/schema/);
 else await run('recoverPending("test")');
 const expected=scenario==='save'?['PUT','POST']:scenario==='publish'?['POST']:scenario==='http500'?['PUT']:[];
 assert.deepEqual(c.calls,expected,scenario+' writes');
 const remains=await fs.readFile(path.join(root,'product-kk-backups',sample.documentId+'.json'),'utf8').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
 assert.equal(remains,!['save','publish','complete'].includes(scenario),scenario+' backup');checks+=2;
}
console.log('Recovery checks passed:',checks);
await fs.rm(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1});
