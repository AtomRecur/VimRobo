"""Read only selected members of CODa's public sequence archive using HTTP ranges.
Never downloads the 119 GB archive or modifies the existing dataset cache.
"""
from pathlib import Path
import io, json, os, requests, threading, time, zipfile, struct, zlib
from concurrent.futures import ThreadPoolExecutor, as_completed

SEQ=21
URL=f'https://web.corral.tacc.utexas.edu/texasrobotics/web_CODa/sequences/{SEQ}.zip'
OUT=Path('/data/users/wangqiuchen/vimrobo_sequence21_20261102')
OUT.mkdir(parents=True,exist_ok=True)
session=requests.Session()
size=int(session.head(URL,timeout=40).headers['Content-Length'])

class RemoteZip(io.RawIOBase):
 def __init__(self):
  self.pos=0; self.start=max(0,size-24*1024*1024)
  r=session.get(URL,headers={'Range':f'bytes={self.start}-{size-1}'},timeout=120)
  r.raise_for_status(); assert r.status_code==206
  self.tail=r.content
 def seekable(self):return True
 def seek(self,offset,whence=0):
  self.pos=offset if whence==0 else self.pos+offset if whence==1 else size+offset
  return self.pos
 def tell(self):return self.pos
 def read(self,n=-1):
  if n<0:n=size-self.pos
  if self.pos>=self.start:
   a=self.pos-self.start; data=self.tail[a:a+n]
  else:
   r=session.get(URL,headers={'Range':f'bytes={self.pos}-{self.pos+n-1}'},timeout=120)
   r.raise_for_status();assert r.status_code==206;data=r.content
  self.pos+=len(data);return data

archive=zipfile.ZipFile(RemoteZip())
infos=archive.infolist()
lidar=[i for i in infos if f'3d_comp/os1/{SEQ}/' in i.filename and i.filename.endswith('.bin')]
lidar.sort(key=lambda i:int(i.filename.rsplit('_',1)[-1][:-4]))
meta=[i for i in infos if (f'poses/dense/{SEQ}.txt' in i.filename or f'calibrations/{SEQ}/' in i.filename or f'timestamps/{SEQ}.txt' in i.filename) and not i.is_dir()]
selected=lidar[::10]
if lidar[-1] not in selected:selected.append(lidar[-1])
print(json.dumps({'total_lidar_frames':len(lidar),'selected':len(selected),'metadata':[i.filename for i in meta],'compressed_bytes':sum(i.compress_size for i in selected)}),flush=True)
(OUT/'archive-selection.json').write_text(json.dumps({'url':URL,'archive_bytes':size,'total_lidar_frames':len(lidar),'step':10,'selected_frames':[int(i.filename.rsplit('_',1)[-1][:-4]) for i in selected],'compressed_bytes':sum(i.compress_size for i in selected)},indent=2))

local=threading.local()
def fetch(info):
 parts=Path(info.filename).parts
 start=next(j for j,p in enumerate(parts) if p in ('3d_comp','poses','calibrations','timestamps'))
 path=OUT/'raw'/Path(*parts[start:]);path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists() and path.stat().st_size==info.file_size:return 0
 if not hasattr(local,'http'):local.http=requests.Session()
 for attempt in range(4):
  try:
   # Local ZIP header + member bytes in one bounded request. Trailing bytes ignored.
   end=info.header_offset+30+len(info.filename.encode('utf-8'))+4096+info.compress_size
   r=local.http.get(URL,headers={'Range':f'bytes={info.header_offset}-{end}'},timeout=90)
   r.raise_for_status();assert r.status_code==206
   data=r.content;name_len,extra_len=struct.unpack_from('<HH',data,26)
   compressed=data[30+name_len+extra_len:30+name_len+extra_len+info.compress_size]
   decoded=zlib.decompress(compressed,-15) if info.compress_type==8 else compressed
   assert len(decoded)==info.file_size and zlib.crc32(decoded)==info.CRC
   temp=path.with_suffix(path.suffix+'.partial');temp.write_bytes(decoded);os.replace(temp,path)
   return len(compressed)
  except Exception:
   if attempt==3:raise
   time.sleep(1+attempt)

for info in meta:fetch(info)
done=0;total=0;began=time.monotonic()
with ThreadPoolExecutor(max_workers=8) as pool:
 futures=[pool.submit(fetch,i) for i in selected]
 for future in as_completed(futures):
  total+=future.result();done+=1
  if done%50==0:print('downloaded',done,'/',len(selected),'MB',round(total/1e6),'elapsed',round(time.monotonic()-began),flush=True)
print('DOWNLOAD COMPLETE',done,flush=True)
