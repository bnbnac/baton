import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveContract,validateConfig,compareIdentity} from './contract.mjs';
const hash='a'.repeat(64);
const config=()=>({app:{path:'app.exe',sha256:hash},adapter:{path:'adapter.exe',sha256:hash},imageId:'sha256:'+hash,pwsh:'pwsh.exe',playwrightPath:'playwright/index.mjs'});
const identity=()=>({sources:{'runner.mjs':hash},binaries:{app:{sha256:hash},adapter:{sha256:hash}},imageId:'sha256:'+hash,environment:{platform:'win32',arch:'x64',osRelease:'1',node:'v22',webview:'155',playwright:'1.62'}});
test('preflight cannot inherit full acceptance or silently choose another scope',()=>{
 assert.equal(resolveContract('M','full').seconds,7200);
 assert.equal(resolveContract('M','preflight').seconds,180);
 assert.equal(resolveContract('F','full').rounds,120);
 assert.equal(resolveContract('F','preflight').rounds,17);
 assert.equal(resolveContract('F','preflight').scopeEligible,false);
 assert.equal(resolveContract('N','full').cases,2);
 for(const args of [['N','preflight'],['X','full'],['M','release'],['M',undefined]])assert.throws(()=>resolveContract(...args));
});
test('config rejects mutable images and malformed binary identity',()=>{
 assert.deepEqual(validateConfig(config()),config());
 for(const change of [c=>c.imageId='tag:latest',c=>c.app.sha256='',c=>c.adapter.path='',c=>delete c.pwsh,c=>c.preflightEvidence={M:42}]){
  const c=config();change(c);assert.throws(()=>validateConfig(c));
 }
});
test('identity comparison fails closed for missing evidence even on both sides',()=>{
 assert.equal(compareIdentity(identity(),identity()).same,true);
 assert.equal(compareIdentity({},{}).same,false);
 for(const change of [i=>i.sources={},i=>delete i.environment.webview,i=>i.environment.node='v23',i=>i.imageId='sha256:'+'b'.repeat(64),i=>i.binaries.app.sha256='b'.repeat(64),i=>i.sources['extra.mjs']=hash]){
  const b=identity();change(b);const result=compareIdentity(identity(),b);assert.equal(result.same,false);assert.ok(result.differences.length);
 }
});
