"""Prepare an inactive-review candidate from the existing n8n exports.

This script never imports, activates, or executes a workflow.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def node(workflow, name):
    return next(n for n in workflow['nodes'] if n['name'] == name)

def patch_preview(w):
    prepare = node(w, 'Prepare Approval')['parameters']['jsonBody']
    original = "author: $('Format Telegram Caption').first().json.author, category:"
    changed = "author: $('Format Telegram Caption').first().json.author, source_author: $('Limit').first().json._embedded?.author?.[0]?.name || $('Format Telegram Caption').first().json.author, category:"
    assert prepare.count(original) == 1
    node(w, 'Prepare Approval')['parameters']['jsonBody'] = prepare.replace(original, changed)
    control = node(w, 'Send Approval Controls')['parameters']['text']
    original = r" + '\n\nVersi desain: '"
    changed = r" + '\n\nKolaborator IG: ' + $('Prepare Approval').first().json.decision.content.requested_collaborators.map(x=>'@'+x).join(', ')" + original
    assert control.count(original) == 1
    node(w, 'Send Approval Controls')['parameters']['text'] = control.replace(original, changed)

def patch_callback(w):
    create = node(w, 'Create Instagram Container')
    params = create['parameters']['queryParameters']['parameters']
    assert [p['name'] for p in params] == ['image_url', 'caption']
    params.append({'name': 'collaborators', 'value': '={{ JSON.stringify($json.decision.content.requested_collaborators) }}'})
    create['onError'] = 'continueRegularOutput'
    def make_code(name, js, position):
        import uuid
        return {'parameters':{'jsCode':js},'type':'n8n-nodes-base.code','typeVersion':2,
                'position':position,'id':str(uuid.uuid4()),'name':name}
    import uuid
    w['nodes'].append(make_code('Only Created Instagram Container',
        "return $input.all().filter(i => /^\\d+$/.test(String(i.json.id||'')));", [1420,180]))
    w['nodes'].append(make_code('Only Instagram Container Error',
        "return $input.all().filter(i => !/^\\d+$/.test(String(i.json.id||'')));", [1420,310]))
    w['nodes'].append({'parameters':{'method':'POST','url':'http://oz-approval:3001/collaboration-error',
        'sendBody':True,'specifyBody':'json',
        'jsonBody':"={{ ({design_version: $('Reserve Channel').first().json.decision.design_version}) }}",
        'options':{'timeout':12000}},'type':'n8n-nodes-base.httpRequest','typeVersion':4.4,
        'position':[1530,310],'id':str(uuid.uuid4()),'name':'Record Collaboration Error'})
    edges = w['connections']['Create Instagram Container']['main'][0]
    assert [x['node'] for x in edges] == ['Record Instagram Container']
    edges[:] = [{'node':name,'type':'main','index':0} for name in
               ['Only Created Instagram Container','Only Instagram Container Error']]
    for start,end in [('Only Created Instagram Container','Record Instagram Container'),
                      ('Only Instagram Container Error','Record Collaboration Error')]:
        w['connections'][start] = {'main':[[{'node':end,'type':'main','index':0}]]}
    revision = node(w, 'Parse Revised Copy')['parameters']['jsCode']
    original = 'author:old.content.author,category:'
    assert revision.count(original) == 1
    node(w, 'Parse Revised Copy')['parameters']['jsCode'] = revision.replace(original, 'author:old.content.author,source_author:old.content.source_author,category:')
    rework = node(w, 'Send Rework Controls')['parameters']['text']
    original = r" + '\n\nHEADLINE:\n'"
    changed = r" + '\nKolaborator IG: ' + $('Prepare Rework Approval').first().json.decision.content.requested_collaborators.map(x=>'@'+x).join(', ')" + original
    assert rework.count(original) == 1
    node(w, 'Send Rework Controls')['parameters']['text'] = rework.replace(original, changed)

def main():
    for kind, patch in [('preview', patch_preview), ('callback', patch_callback)]:
        src = ROOT / f'oz_approval_{kind}_staging.json'
        workflows = json.loads(src.read_text())
        assert len(workflows) == 1
        patch(workflows[0])
        workflows[0]['active'] = False
        dst = ROOT / f'oz_approval_{kind}_collaborator_CANDIDATE.json'
        dst.write_text(json.dumps(workflows, ensure_ascii=False, indent=2) + '\n')
        print(f'{kind}: {dst.name} (inactive review candidate)')

if __name__ == '__main__':
    main()
