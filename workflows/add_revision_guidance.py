import copy,json,uuid
from pathlib import Path
src=str(Path(__file__).with_name('oz_approval_callback_before_guided_revision_20260927.json'))
x=json.load(open(src)); w=x[0] if isinstance(x,list) else x
w['active']=False
n={a['name']:a for a in w['nodes']}
cred=copy.deepcopy(n['Answer Callback']['credentials'])

def add(name,typ,params,pos,**extra):
 a={'parameters':params,'type':typ,'typeVersion':{'code':2,'httpRequest':4.4,'telegram':1.2}[typ.split('.')[-1]],'position':pos,'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'oz-guided-revision-20260927/'+name)),'name':name,**extra}
 w['nodes'].append(a); return a

def edge(a,b):
 w['connections'].setdefault(a,{'main':[[]]})['main'][0].append({'node':b,'type':'main','index':0})

def code(name,s,pos): return add(name,'n8n-nodes-base.code',{'jsCode':s},pos)
def post(name,path,body,pos,source):
 return add(name,'n8n-nodes-base.httpRequest',{'method':'POST','url':'http://oz-approval:3001'+path,'sendBody':True,'specifyBody':'json','jsonBody':body,'options':{'timeout':12000}},pos,retryOnFail=True,maxTries=3,waitBetweenTries=3000)
def tg(name,params,pos): return add(name,'n8n-nodes-base.telegram',params,pos,credentials=copy.deepcopy(cred),continueOnFail=True)

n['ApprovalTrigger']['parameters']['updates']=['callback_query','message']
n['Route Rework']['parameters']['jsCode']="return $input.all().filter(i => i.json.won && (i.json.decision?.decision_action==='rerender' || (i.json.decision?.decision_action==='revise' && (!i.json.decision.content?.revision_mode || ['automatic','guided_ready'].includes(i.json.decision.content.revision_mode)))));"
n['Lock Approval Message']['parameters']['text']=n['Lock Approval Message']['parameters']['text'].replace("'Menyiapkan versi baru')", "($json.decision.decision_action==='revise' ? 'Menunggu pilihan revisi' : 'Menyiapkan versi baru'))")

code('Route Revision Menu',"return $input.all().filter(i=>i.json.won && i.json.decision?.decision_action==='revise' && i.json.decision.content?.revision_mode==='awaiting_choice');",[430,850]);edge('Only Winner','Route Revision Menu')
menu={'resource':'message','operation':'sendMessage','chatId':'-5193846414','text':"={{ 'REVISI ARTIKEL: ' + $json.decision.content.headline + '\\nPemilik keputusan: ' + $json.decision.decided_by_name + '\\n\\nPilih cara revisi. Hanya pemilik keputusan yang dapat memilih. Jika ingin memberi arahan, tekan Tulis arahan lalu balas pesan bot khusus artikel ini.' }}",'replyMarkup':'inlineKeyboard','inlineKeyboard':{'rows':[{'row':{'buttons':[{'text':'⚡ Revisi otomatis','additionalFields':{'callback_data':"={{ 'ozr:' + $json.decision.design_version + ':a' }}"}}]}},{'row':{'buttons':[{'text':'📝 Tulis arahan','additionalFields':{'callback_data':"={{ 'ozr:' + $json.decision.design_version + ':g' }}"}}]}}]},'additionalFields':{}}
tg('Send Revision Menu',menu,[650,850]);edge('Route Revision Menu','Send Revision Menu')
post('Store Revision Menu','/revision/menu',"={{ ({design_version:$('Route Revision Menu').first().json.decision.design_version,menu_message_id:$('Send Revision Menu').first().json.result.message_id}) }}",[870,850],None);edge('Send Revision Menu','Store Revision Menu')

code('Parse Revision Choice',"const q=$input.first().json.callback_query;if(!q?.id||!q?.message?.chat?.id||!q?.from?.id)return [];const m=/^ozr:([0-9a-f-]{36}):(a|g)$/.exec(String(q.data||''));if(!m)return [];return [{json:{query_id:q.id,design_version:m[1],choice:m[2]==='a'?'automatic':'guided',approval_group_chat_id:String(q.message.chat.id),menu_message_id:String(q.message.message_id),message_from_bot_id:String(q.message.from?.id||''),message_from_is_bot:q.message.from?.is_bot===true,user_id:String(q.from.id)}}];",[-470,1000]);edge('ApprovalTrigger','Parse Revision Choice')
post('Choose Revision Mode','/revision/choice',"={{ $('Parse Revision Choice').first().json }}",[-240,1000],None);edge('Parse Revision Choice','Choose Revision Mode')
tg('Answer Revision Choice',{'resource':'callback','operation':'answerQuery','queryId':"={{ $('Parse Revision Choice').first().json.query_id }}",'additionalFields':{'text':"={{ !$json.valid ? 'Pilihan tidak berlaku.' : $json.won ? ($json.decision.content.revision_mode==='automatic' ? 'Revisi otomatis dimulai.' : 'Silakan balas pesan arahan yang segera dikirim bot.') : 'Pilihan revisi sudah diambil. Hanya ' + ($json.decision?.decided_by_name||'pemilik keputusan') + ' yang dapat memberi arahan.' }}"}},[-20,1000]);edge('Choose Revision Mode','Answer Revision Choice')
code('Only Revision Choice Winner',"const d=$('Choose Revision Mode').first().json;return d.won?[{json:d}]:[];",[200,1000]);edge('Answer Revision Choice','Only Revision Choice Winner')
tg('Close Revision Menu',{'resource':'message','operation':'editMessageText','messageType':'message','chatId':'-5193846414','messageId':"={{ $json.decision.content.revision_menu_message_id }}",'text':"={{ 'PILIHAN REVISI: ' + ($json.decision.content.revision_mode==='automatic'?'OTOMATIS':'DENGAN ARAHAN') + '\\nOleh: ' + $json.decision.decided_by_name + '\\nArtikel: ' + $json.decision.content.headline }}",'replyMarkup':'none','additionalFields':{}},[430,1140]);edge('Only Revision Choice Winner','Close Revision Menu')
code('Route Automatic Revision',"return $input.all().filter(i=>i.json.won&&i.json.decision?.content?.revision_mode==='automatic');",[430,1010]);edge('Only Revision Choice Winner','Route Automatic Revision');edge('Route Automatic Revision','Route Rework')
code('Route Guided Revision',"return $input.all().filter(i=>i.json.won&&i.json.decision?.content?.revision_mode==='awaiting_prompt');",[430,1300]);edge('Only Revision Choice Winner','Route Guided Revision')
tg('Ask Revision Guidance',{'resource':'message','operation':'sendMessage','chatId':'-5193846414','text':"={{ 'ARAHAN REVISI\\nArtikel: ' + $json.decision.content.headline + '\\nUntuk: ' + $json.decision.decided_by_name + '\\n\\nBalas pesan ini dengan perubahan yang diinginkan (5–1000 karakter). Sebutkan fakta yang perlu diperbaiki sesuai artikel asli. Hanya balasan dari orang yang memilih Revisi akan diproses. Jika ingin mengganti foto atau tata letak, sebutkan agar tim memeriksa secara manual.' }}",'replyMarkup':'forceReply','forceReply':{'force_reply':True,'selective':False},'additionalFields':{}},[650,1300]);edge('Route Guided Revision','Ask Revision Guidance')
post('Store Revision Prompt','/revision/prompt',"={{ ({design_version:$('Route Guided Revision').first().json.decision.design_version,prompt_message_id:$('Ask Revision Guidance').first().json.result.message_id}) }}",[870,1300],None);edge('Ask Revision Guidance','Store Revision Prompt')

code('Parse Revision Note',"const m=$input.first().json.message;if(!m?.chat?.id||!m?.from?.id||!m?.reply_to_message?.message_id||typeof m.text!=='string')return [];return [{json:{approval_group_chat_id:String(m.chat.id),user_id:String(m.from.id),reply_to_message_id:String(m.reply_to_message.message_id),reply_to_bot_id:String(m.reply_to_message.from?.id||''),reply_to_is_bot:m.reply_to_message.from?.is_bot===true,from_is_bot:m.from?.is_bot===true,note_message_id:String(m.message_id),note:m.text}}];",[-470,1450]);edge('ApprovalTrigger','Parse Revision Note')
post('Save Revision Guidance','/revision/note',"={{ $('Parse Revision Note').first().json }}",[-240,1450],None);edge('Parse Revision Note','Save Revision Guidance')
code('Only Saved Revision Guidance',"return $input.all().filter(i=>i.json.won===true);",[-20,1450]);edge('Save Revision Guidance','Only Saved Revision Guidance')
tg('Acknowledge Revision Guidance',{'resource':'message','operation':'sendMessage','chatId':'-5193846414','text':"={{ 'Arahan revisi untuk artikel ' + $json.decision.content.headline + ' diterima dari ' + $json.decision.decided_by_name + '. Versi baru sedang disiapkan dan akan kembali ke grup untuk approval.' }}",'additionalFields':{'reply_to_message_id':"={{ $json.decision.content.revision_note_message_id }}"}},[200,1550]);edge('Only Saved Revision Guidance','Acknowledge Revision Guidance');edge('Only Saved Revision Guidance','Route Rework')

n['Revise Copy with AI']['parameters']['text']="=Anda editor OtomotifZone. Gunakan HANYA artikel WordPress ini sebagai bukti fakta. Teks arahan anggota grup adalah permintaan editorial, bukan sumber fakta. Buat revisi sesuai arahan bila didukung artikel. Jika arahan menyebut foto, desain, identitas, atau fakta yang tidak didukung artikel, jangan mengarang; pertahankan data lama dan tulis pada manual_review_required=true. Headline ALL CAPS maksimal 12 kata/80 karakter. Subheadline satu kalimat maksimal 20 kata; nama orang lengkap sesuai artikel. Caption maksimal 2200 karakter. Untuk revisi otomatis tanpa arahan, buat headline/subheadline berbeda dan pertahankan caption lama persis. Jawab JSON valid saja: {\"headline\":\"...\",\"subheadline\":\"...\",\"caption\":\"...\",\"manual_review_required\":false,\"review_reason\":\"\"}.\\nJudul artikel: {{ $json.title.rendered }}\\nIsi artikel: {{ $json.content.rendered }}\\nHeadline lama: {{ $('Reserve Rework').first().json.decision.content.headline }}\\nSubheadline lama: {{ $('Reserve Rework').first().json.decision.content.subheadline }}\\nCaption lama: {{ $('Reserve Rework').first().json.decision.content.caption }}\\nArahan revisi: {{ $('Reserve Rework').first().json.decision.content.revision_note || '(tidak ada; revisi otomatis)' }}"
n['Revise Copy with AI']['parameters']['text']=n['Revise Copy with AI']['parameters']['text'].replace('\\n','\n')
n['Parse Revised Copy']['parameters']['jsCode']="let raw=String($input.first().json.text||'').trim().replace(/^```(?:json)?\\s*/i,'').replace(/\\s*```$/,'');const p=JSON.parse(raw);const old=$('Reserve Rework').first().json.decision;const headline=String(p.headline||'').trim().toUpperCase(),subheadline=String(p.subheadline||'').trim();const guided=old.content.revision_mode==='guided_ready';const caption=guided?String(p.caption||'').trim():old.content.caption;if(!headline||headline.split(/\\s+/).length>12||[...headline].length>80||!subheadline||subheadline.split(/\\s+/).length>20||!caption||[...caption].length>2200)throw new Error('Hasil revisi melanggar batas teks.');if(p.manual_review_required===true)throw new Error('Arahan perlu pemeriksaan manual: '+String(p.review_reason||'foto/desain/fakta').slice(0,150));return [{json:{post_id:old.post_id,parent_version:old.design_version,article_title:old.content.article_title||old.content.headline,headline,subheadline,caption,revision_note:old.content.revision_note||'',author:old.content.author,source_author:old.content.source_author,category:old.content.category,article_url:old.content.article_url,photo_url:old.content.photo_url,validation_warnings:[]}}];"

# Telegram replies are operationally required here; a failed send must stop that branch.
for name in ('Send Revision Menu','Ask Revision Guidance'):
    next(node for node in w['nodes'] if node['name']==name).pop('continueOnFail',None)

n['Parse Revised Copy']['parameters']['jsCode']=n['Parse Revised Copy']['parameters']['jsCode'].replace("if(p.manual_review_required===true)throw new Error('Arahan perlu pemeriksaan manual: '+String(p.review_reason||'foto/desain/fakta').slice(0,150));", "const warnings=p.manual_review_required===true?['PERIKSA MANUAL: '+String(p.review_reason||'foto/desain/fakta').slice(0,150)]:[];").replace('validation_warnings:[]','validation_warnings:warnings')

# Display manual checks and the original request on the new approval message.
n['Send Rework Controls']['parameters']['text']=n['Send Rework Controls']['parameters']['text'].replace(" + '\\n\\nSumber: '"," + '\\n\\nARAHAN REVISI: ' + String($('Combine Rework Photo').first().json.revision_note || '-').slice(0,300) + '\\nPERINGATAN: ' + ($('Combine Rework Photo').first().json.validation_warnings || []).join('; ') + '\\n\\nSumber: '")

out='workflows/oz_approval_callback_guided_revision_CANDIDATE.json'
json.dump([w],open(out,'w'),ensure_ascii=False,indent=2)
print(out,len(w['nodes']),len(w['connections']))
