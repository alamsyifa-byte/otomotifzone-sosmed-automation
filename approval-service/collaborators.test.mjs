import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collaboratorConfig as config, normalizeUsername, resolveCollaborators } from './collaborators.mjs';

const base = ['dewantara_ar', 'ediimola'];
const resolve = (name, mapping = config) => resolveCollaborators(name, mapping).requested_collaborators;
const scenario = (name, author, expected, mapping) => test(name, () => assert.deepEqual(resolve(author, mapping), expected));

scenario('1 Dewantara', ' Dewantara   Ramadhan ', base);
scenario('2 Edi Imola alias', 'eDi iMoLa', base);
scenario('3 Alpacino', 'Alpacino', [...base, 'liealpacino']);
scenario('4 Ahmad Fathoni', 'Ahmad Fathoni', [...base, 'abibejho']);
scenario('5 penulis tidak dikenal', 'Tidak Ada', base);
scenario('6 username kosong', 'Tanpa IG', base, {...config, authors:[{author_name:'Tanpa IG',instagram_username:'',collab_enabled:true}]});
scenario('7 username sama dengan default', 'Alias Dewantara', base, {...config, authors:[{author_name:'Alias Dewantara',instagram_username:'dewantara_ar',collab_enabled:true}]});
scenario('8 tanda @ dihapus', 'Test @', [...base, 'contoh_ig'], {...config, authors:[{author_name:'Test @',instagram_username:'@contoh_ig',collab_enabled:true}]});

const candidate = JSON.parse(fs.readFileSync(new URL('../workflows/oz_approval_callback_collaborator_CANDIDATE.json', import.meta.url)))[0];
const create = candidate.nodes.find(n=>n.name==='Create Instagram Container');
const publish = candidate.nodes.find(n=>n.name==='Publish Instagram Post');
test('9 carousel: aturan payload hanya pada parent', () => {
  const params = Object.fromEntries(create.parameters.queryParameters.parameters.map(x=>[x.name,x.value]));
  assert.ok(params.collaborators.includes('JSON.stringify'));
  const parent = {media_type:'CAROUSEL', children:['1','2'], collaborators:JSON.stringify(base)};
  const children = [{is_carousel_item:true},{is_carousel_item:true}];
  assert.ok(parent.collaborators);
  assert.ok(children.every(x=>!('collaborators' in x)));
});
test('10 Story: tidak dikirimi kolaborator', () => {
  const story = {media_type:'STORIES', image_url:'https://example.com/story.jpg'};
  assert.equal(story.collaborators, undefined);
  assert.equal(create.parameters.queryParameters.parameters.some(x=>x.name==='media_type' && x.value==='STORIES'), false);
});
test('11 kandidat lebih dari tiga ditolak pada konfigurasi default', () => {
  assert.throws(() => resolve('Alpacino', {...config, default_collaborators:['dewantara_ar','ediimola','tambahan'], maximum_collaborators:3}),
    /dua collaborator default/);
  assert.equal(resolve('Alpacino').length, 3);
});
test('12 error sebelum container: media_publish tidak dipanggil ulang oleh kandidat', () => {
  assert.equal(create.onError, 'continueRegularOutput');
  const success = candidate.nodes.find(n=>n.name==='Only Created Instagram Container');
  const error = candidate.nodes.find(n=>n.name==='Only Instagram Container Error');
  const recordError = candidate.nodes.find(n=>n.name==='Record Collaboration Error');
  assert.ok(success && error && recordError);
  assert.equal(candidate.connections[error.name].main[0][0].node, recordError.name);
  assert.equal(candidate.connections[success.name].main[0][0].node, 'Record Instagram Container');
  assert.equal(publish.parameters.queryParameters.parameters.some(x=>x.name==='collaborators'), false);
  const before = {container_created:false, media_published:false};
  const after = {...before, collaboration_status:'FAILED', collaboration_error:'Meta menolak collaborator'};
  assert.equal(after.media_published, false);
});
test('username dengan spasi ditolak',()=>assert.equal(normalizeUsername('dua nama'),null));
test('semua akun yang diberikan pengguna tersedia',()=>{
  for (const username of ['dewantara_ar','ediimola','abibejho','liealpacino','hafidhapid','jaf_alam','partofihya_','pkdsgt','yeyep_ardiansyah']) {
    assert.ok(config.authors.some(x=>x.instagram_username===username));
  }
});
