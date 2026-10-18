import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
const hash=/^[a-f0-9]{64}$/;
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
export function resolveContract(scope,profile){
 assert.ok(['M','F','N'].includes(scope),'invalid_scope');
 assert.ok(['preflight','full'].includes(profile),'invalid_profile');
 assert.ok(scope!=='N'||profile==='full','native_preflight_unsupported');
 return Object.freeze({scope,profile,seconds:scope==='M'?(profile==='full'?7200:180):scope==='N'?900:0,
  rounds:scope==='M'?(profile==='full'?120:3):scope==='F'?(profile==='full'?120:17):0,
  cases:scope==='N'?2:0,scopeEligible:profile==='full'});
}
export function validateConfig(c){
 assert.ok(c&&typeof c==='object','config_required');
 for(const key of ['app','adapter'])assert.ok(nonempty(c[key]?.path)&&hash.test(c[key]?.sha256),'binary_identity_'+key);
 assert.match(c.imageId??'',/^sha256:[a-f0-9]{64}$/,'immutable_image');
 for(const key of ['pwsh','playwrightPath'])assert.ok(nonempty(c[key]),'config_'+key);
 if(c.baselineEvidence!==undefined)assert.ok(nonempty(c.baselineEvidence),'baseline_evidence');
 if(c.preflightEvidence!==undefined){
  assert.ok(c.preflightEvidence&&typeof c.preflightEvidence==='object'&&!Array.isArray(c.preflightEvidence),'preflight_evidence');
  for(const [scope,path] of Object.entries(c.preflightEvidence))assert.ok(['M','F'].includes(scope)&&nonempty(path),'preflight_evidence');
 }
 return c;
}
function validIdentity(i){
 return i&&i.sources&&Object.keys(i.sources).length>0&&Object.values(i.sources).every(v=>hash.test(v))
  &&['app','adapter'].every(k=>hash.test(i.binaries?.[k]?.sha256))
  &&/^sha256:[a-f0-9]{64}$/.test(i.imageId)
  &&['platform','arch','osRelease','node','webview','playwright'].every(k=>nonempty(i.environment?.[k]));
}
export function compareIdentity(a,b){
 const differences=[];
 if(!validIdentity(a))differences.push('invalid_left_identity');
 if(!validIdentity(b))differences.push('invalid_right_identity');
 if(!differences.length){
  for(const key of ['sources','imageId','environment'])if(!isDeepStrictEqual(a[key],b[key]))differences.push(key);
  for(const key of ['app','adapter'])if(a.binaries[key].sha256!==b.binaries[key].sha256)differences.push('binary_'+key);
 }
 return {same:differences.length===0,differences};
}
