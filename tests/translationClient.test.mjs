import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { build } from 'esbuild';
async function bundle(path) {
 const {outputFiles}=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env.VITE_API_URL':'""'}});
 return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const {TranslationClient,audioFilename}=await bundle('src/api/translationClient.ts');
const {fetchResponse}=await bundle('src/api/request.ts');
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch});
const client=new TranslationClient();
test('empty or malformed successful translation is an error, not a fake result',async()=>{
 for(const payload of [{},{translation:''},{translation:42}]){
  globalThis.fetch=async()=>new Response(JSON.stringify(payload),{status:200});
  await assert.rejects(client.translateText('house'),/empty translation/);
 }
});
test('audio uploads retain their real container and filename',async()=>{
 const audio=new Blob(['audio'],{type:'audio/webm;codecs=opus'});
 assert.equal(audioFilename(audio),'recording.webm');
 globalThis.fetch=async(_url,init)=>{
  assert.equal(init.body.get('audio').name,'recording.webm');
  assert.equal(init.body.get('audio').type,audio.type);
  return new Response(JSON.stringify({transcription:'house'}));
 };
 assert.equal((await client.transcribeAudio(audio,'English')).transcription,'house');
});
test('timeout aborts a stalled request without retrying it',async()=>{
 let calls=0;
 globalThis.fetch=(_url,{signal})=>new Promise((resolve,reject)=>{
  calls++;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 });
 await assert.rejects(fetchResponse('/slow',{},10),/took too long/);
 assert.equal(calls,1);
});
test('deadline includes slow response body',async()=>{
 globalThis.fetch=async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
 await assert.rejects(fetchResponse('/slow-body',{},10),/took too long/);
});
test('caller cancellation propagates to the request',async()=>{
 const controller=new AbortController();
 globalThis.fetch=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 const pending=fetchResponse('/cancel',{signal:controller.signal});
 controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
});
