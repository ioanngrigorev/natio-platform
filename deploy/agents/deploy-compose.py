#!/usr/bin/env python3
"""Trusted deployment hook. Install outside the checkout with a fixed config.
Build only committed files, replace only configured app services, verify image
identity and container health, and restore previous images on a failed rollout.
No migrations are allowed in agent candidates.
"""
import fcntl,json,os,pathlib,re,subprocess,sys,tempfile,time

def run(args,**kwargs):
    return subprocess.check_output(args,text=True,**kwargs).strip()

def main():
    cfg=json.loads(pathlib.Path(os.environ['NATIO_DEPLOY_CONFIG']).read_text())
    workspace,sha,base,run_id=sys.argv[1:]
    if not all(re.fullmatch('[a-f0-9]{40}',s) for s in (sha,base)) or not re.fullmatch('[a-f0-9-]{36}',run_id):
        raise ValueError('Invalid immutable deployment identifiers')
    marker=pathlib.Path(cfg['revision_file'])
    lock=open(str(marker)+'.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
    if marker.read_text().strip()!=base:
        raise RuntimeError('Target advanced since development started; rebase and rerun tests')
    git=['git','-c','core.hooksPath=/dev/null','-C',workspace]
    if run(git+['rev-parse','HEAD'])!=sha:
        raise RuntimeError('Candidate changed')
    remote=cfg['publish_remote'];branch=cfg['publish_branch']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./-]*',branch) or run(git+['rev-parse',sha+'^'])!=base:
        raise RuntimeError('Candidate must be one commit on the reviewed base')
    compose=['docker','compose','--project-name',cfg['project'],'--env-file',cfg['env_file'],'-f',cfg['compose_file']]
    services=cfg['services'] # service name -> api or web; e.g. api, worker, web
    if not services or any(v not in ('api','web') for v in services.values()):raise ValueError('Invalid service map')
    previous={}
    for service in services:
        cid=run(compose+['ps','-q',service])
        if not cid:raise RuntimeError('Target service is not running')
        previous[service]=run(['docker','inspect','--format','{{.Image}}',cid])
    with tempfile.TemporaryDirectory(prefix='natio-release-') as d:
        root=pathlib.Path(d);archive=root/'source.tar';source=root/'source';source.mkdir()
        with archive.open('wb') as out:subprocess.run(git+['archive','--format=tar',sha],stdout=out,check=True)
        subprocess.run(['tar','xf',str(archive),'-C',str(source)],check=True)
        images={}
        for kind in sorted(set(services.values())):
            tag=f'natio/agent-{kind}:{sha}'
            args=['docker','build','--build-arg',f'NATIO_GIT_SHA={sha}','--label',f'org.opencontainers.image.revision={sha}','-t',tag,'-f',str(source/f'apps/{kind}/Dockerfile')]
            for key,value in cfg.get('build_args',{}).get(kind,{}).items():args+=['--build-arg',f'{key}={value}']
            subprocess.run(args+[str(source)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            images[kind]=run(['docker','image','inspect','--format','{{.Id}}',tag])
        override=root/'images.json'
        def write_override(mapping):override.write_text(json.dumps({'services':{s:{'image':image} for s,image in mapping.items()}}))
        expected={s:images[k] for s,k in services.items()};write_override(expected)
        updated=compose+['-f',str(override)]
        def verify(mapping):
            deadline=time.monotonic()+max(10,min(180,int(cfg.get('health_timeout_seconds',180))))
            while time.monotonic()<deadline:
                healthy=True
                for s,image in mapping.items():
                    cid=run(updated+['ps','-q',s])
                    if not cid:healthy=False;continue
                    info=json.loads(run(['docker','inspect',cid]))[0]
                    if info['Image']!=image or info['State'].get('Health',{}).get('Status')!='healthy':healthy=False
                if healthy:return
                time.sleep(3)
            raise RuntimeError('Rollout health or image identity check failed')
        try:
            subprocess.run(updated+['up','-d','--no-deps','--no-build',*services],check=True,stdout=subprocess.DEVNULL)
            verify(expected)
            # Advance only the expected branch tip, after healthy rollout. A
            # rejected/stale push rolls the application back to the prior image.
            subprocess.run(git+['push',f'--force-with-lease=refs/heads/{branch}:{base}',remote,f'{sha}:refs/heads/{branch}'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        except Exception:
            write_override(previous)
            subprocess.run(updated+['up','-d','--no-deps','--no-build',*services],check=True,stdout=subprocess.DEVNULL)
            verify(previous)
            raise
        # Persist override for subsequent operator restarts; never change base config.
        pathlib.Path(cfg['release_override']).write_text(override.read_text())
        tmp=marker.with_suffix('.tmp');tmp.write_text(sha+'\n');tmp.replace(marker)
        print(json.dumps({'run_id':run_id,'commit':sha,'status':'healthy'}))
if __name__=='__main__':main()
