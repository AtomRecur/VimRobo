"""Build a dense static campus from a complete, locally archived CODa sequence.

Inputs remain read-only. Run with the existing /data/anaconda3 Python on re_debug2.
RGB surface samples interpolate only short, depth-continuous LiDAR triangles;
unobserved roofs / surfaces are never invented or filled.
"""
from pathlib import Path
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import io, json, time, zipfile, threading, argparse
import numpy as np, yaml
from PIL import Image, ImageEnhance
from scipy.spatial import Delaunay, ConvexHull
from scipy.spatial.transform import Rotation
from scipy.ndimage import minimum_filter, distance_transform_edt
from concurrent.futures import ThreadPoolExecutor

parser=argparse.ArgumentParser()
parser.add_argument('--sequence',type=int,default=7)
parser.add_argument('--step',type=int,default=10)
parser.add_argument('--limit',type=int,default=0)
parser.add_argument('--finish-only',action='store_true')
args=parser.parse_args()
SEQ=args.sequence
ROOT=Path('/data/users/wangqiuchen/vimrobo_dense_render_20261102')
OUT=ROOT/'assets';CACHE=ROOT/f'cache-seq{SEQ}-step{args.step}'
OUT.mkdir(parents=True,exist_ok=True);CACHE.mkdir(parents=True,exist_ok=True)
ARCHIVE=Path(f'/data/users/wangqiuchen/coda_full/{SEQ}.zip')
archive=zipfile.ZipFile(ARCHIVE)
poses=np.loadtxt(io.BytesIO(archive.read(f'poses/dense/{SEQ}.txt')))
P=np.array(yaml.safe_load(archive.read(f'calibrations/{SEQ}/calib_os1_to_cam0.yaml'))['projection_matrix']['data'],dtype=np.float64).reshape(3,4)
Pinv=np.linalg.inv(P[:,:3])
quaternions=poses[:,[5,6,7,4]].copy()
quaternion_norm=np.linalg.norm(quaternions,axis=1)
valid_pose=np.isfinite(quaternions).all(1)&(np.abs(quaternion_norm-1)<.02)
quaternions[~valid_pose]=[0,0,0,1]
quaternions/=np.linalg.norm(quaternions,axis=1)[:,None]
R=Rotation.from_quat(quaternions).as_matrix().astype(np.float32)
lo=np.floor((poses[:,1:3].min(0)-35)/10)*10
hi=np.ceil((poses[:,1:3].max(0)+35)/10)*10
extent=hi-lo;center=(hi+lo)/2
ground=float(poses[:,3].min()-2.2)
LONG=int(np.argmax(extent));SHORT=1-LONG
scale=18/extent[LONG]
HEIGHT_SCALE=.8
VOX=.07
indices=[i for i in range(0,len(poses),args.step) if valid_pose[i]]
if indices[-1]!=len(poses)-1:indices.append(len(poses)-1)
if args.limit:indices=indices[:args.limit]
local=threading.local()
def get_zip():
 if not hasattr(local,'zip'):local.zip=zipfile.ZipFile(ARCHIVE)
 return local.zip

def transform(p,i):return (p@R[i].T+poses[i,1:4]).astype(np.float32)
def valid_world(w):return (w[:,0]>=lo[0])&(w[:,0]<hi[0])&(w[:,1]>=lo[1])&(w[:,1]<hi[1])&(w[:,2]>=ground)&(w[:,2]<ground+38)
def normalize(p):
 a=np.asarray(p)
 return np.column_stack(((a[:,LONG]-center[LONG])*scale,(a[:,2]-ground)*scale*HEIGHT_SCALE,(a[:,SHORT]-center[SHORT])*scale)).astype(np.float32)

def process(i):
 z=get_zip()
 raw=np.frombuffer(z.read(f'3d_comp/os1/{SEQ}/3d_comp_os1_{SEQ}_{i}.bin'),dtype=np.float32).reshape(128*1024,-1)[:,:3].copy()
 distance=np.linalg.norm(raw,axis=1)
 good=np.isfinite(raw).all(1)&(distance>1.25)&(distance<55)
 p=raw[good];world=transform(p,i);inside=valid_world(world)
 p=p[inside];world=world[inside]
 # A spatially even subset of the full 360-degree measured scan for the middle layer.
 scan=world[::5]
 im=np.asarray(Image.open(io.BytesIO(z.read(f'2d_rect/cam0/{SEQ}/2d_rect_cam0_{SEQ}_{i}.png'))).convert('RGB'))
 projected=p@P[:,:3].T+P[:,3]
 depth=projected[:,2]
 uv=projected[:,:2]/np.maximum(depth[:,None],.0001)
 valid=(depth>1)&(depth<45)&(uv[:,0]>3)&(uv[:,0]<im.shape[1]-4)&(uv[:,1]>3)&(uv[:,1]<im.shape[0]-4)
 p=p[valid];world=world[valid];uv=uv[valid];depth=depth[valid]
 # Camera-space z buffer rejects points hidden by a closer measured surface.
 ux=(uv[:,0]/2).astype(np.int32);vy=(uv[:,1]/2).astype(np.int32)
 dw=(im.shape[1]+1)//2;dh=(im.shape[0]+1)//2
 zb=np.full((dh,dw),np.inf,np.float32)
 np.minimum.at(zb,(vy,ux),depth)
 front=minimum_filter(zb,size=3,mode='constant',cval=np.inf)
 visible=depth<=front[vy,ux]+.25+.012*depth
 p=p[visible];world=world[visible];uv=uv[visible];depth=depth[visible]
 rgb=im[uv[:,1].astype(int),uv[:,0].astype(int)]
 weight=np.clip((1-depth/60)**2,.06,1).astype(np.float32)
 measured_colored=len(world)
 # Densify locally planar observed surfaces with their actual camera texture.
 # No interpolation across a depth discontinuity, long 3D edge, or outside the scan.
 if i%(args.step*2)==0 and len(uv)>100:
  rounded=np.round(uv*2).astype(np.int32)
  _,keep=np.unique(rounded,axis=0,return_index=True)
  uvv=uv[keep];dd=depth[keep];pp=p[keep]
  try:
   triang=Delaunay(uvv)
   tri=triang.simplices
   dep=dd[tri];depmin=dep.min(1)
   span=dep.max(1)-depmin
   edge=np.maximum.reduce([np.linalg.norm(pp[tri[:,0]]-pp[tri[:,1]],axis=1),np.linalg.norm(pp[tri[:,1]]-pp[tri[:,2]],axis=1),np.linalg.norm(pp[tri[:,0]]-pp[tri[:,2]],axis=1)])
   triok=(span<.35+.035*depmin)&(edge<.40+.035*depmin)&(depmin<28)
   yy,xx=np.mgrid[5:im.shape[0]-5:3,5:im.shape[1]-5:3]
   pix=np.column_stack((xx.ravel(),yy.ravel()))
   simplex=triang.find_simplex(pix)
   ok=(simplex>=0)&triok[np.maximum(simplex,0)]
   pix=pix[ok];sid=simplex[ok]
   delta=pix-triang.transform[sid,2]
   bc=np.einsum('ijk,ik->ij',triang.transform[sid,:2,:],delta)
   bc=np.column_stack((bc,1-bc.sum(1)))
   d=1/np.sum(bc/dd[tri[sid]],axis=1)
   camera=np.column_stack((pix[:,0]*d,pix[:,1]*d,d))
   dense=(camera-P[:,3])@Pinv.T
   dworld=transform(dense,i);ok=valid_world(dworld)&(d<28)
   dworld=dworld[ok];pix=pix[ok];d=d[ok]
   world=np.concatenate((world,dworld));rgb=np.concatenate((rgb,im[pix[:,1],pix[:,0]]))
   weight=np.concatenate((weight,np.clip((1-d/45)**2,.05,1).astype(np.float32)*.65))
  except Exception as exc:print('densify skipped',i,str(exc)[:100],flush=True)
 return world,rgb,weight,scan,len(raw),measured_colored

def voxel_key(p,vox=VOX):
 q=np.floor((p-np.array([lo[0],lo[1],ground],np.float32))/vox).astype(np.int64)
 return q[:,0]+(q[:,1]<<14)+(q[:,2]<<28)

def fuse(p,c,w):
 keys=voxel_key(p)
 unique,inverse=np.unique(keys,return_inverse=True)
 weight=np.bincount(inverse,weights=w).astype(np.float32)
 out=np.empty((len(unique),7),np.float32)
 for j in range(3):out[:,j]=np.bincount(inverse,weights=p[:,j]*w)
 for j in range(3):out[:,j+3]=np.bincount(inverse,weights=c[:,j]*w)
 out[:,6]=weight
 return unique,out

started=time.monotonic();counts={'raw_points':0,'measured_colored_points':0,'surface_samples':0}
if not args.finish_only:
 with ThreadPoolExecutor(max_workers=4) as pool:
  for bi in range(0,len(indices),24):
   chunk=CACHE/f'chunk-{bi//24:04d}.npz'
   if chunk.exists():continue
   collected=list(pool.map(process,indices[bi:bi+24]))
   p=np.concatenate([c[0] for c in collected]);c=np.concatenate([c[1] for c in collected]);w=np.concatenate([c[2] for c in collected])
   keys,sums=fuse(p,c,w)
   scans=np.concatenate([c[3] for c in collected])
   sk=voxel_key(scans,.23);_,si=np.unique(sk,return_index=True);scans=scans[si]
   if len(scans)>100000:scans=scans[np.random.default_rng(bi).choice(len(scans),100000,False)]
   cnt=np.array([sum(c[4] for c in collected),sum(c[5] for c in collected),len(p)],dtype=np.int64)
   np.savez(chunk,keys=keys,sums=sums,scan=scans,counts=cnt)
   print('FUSED',min(bi+24,len(indices)),'/',len(indices),'chunk_voxels',len(keys),'seconds',round(time.monotonic()-started),flush=True)

parts=sorted(CACHE.glob('chunk-*.npz'))
allkeys=[];allsums=[];scans=[];totals=np.zeros(3,np.int64)
for path in parts:
 d=np.load(path);allkeys.append(d['keys']);allsums.append(d['sums']);scans.append(d['scan']);totals+=d['counts']
keys=np.concatenate(allkeys);sums=np.concatenate(allsums);del allkeys,allsums
print('GLOBAL FUSION',len(keys),'voxel observations',flush=True)
order=np.argsort(keys);keys=keys[order];sums=sums[order];del order
starts=np.r_[0,np.flatnonzero(keys[1:]!=keys[:-1])+1]
agg=np.add.reduceat(sums,starts,axis=0);del keys,sums,starts
cp=agg[:,:3]/agg[:,6,None];cc=np.clip(agg[:,3:6]/agg[:,6,None],0,255).astype(np.uint8)
confidence=agg[:,6];del agg
print('FUSED COLOR POINTS',len(cp),flush=True)

# High-resolution top view, using the visible highest measured surface per pixel.
W=8192;H=int(round(W*extent[SHORT]/extent[LONG]))
u=np.floor((cp[:,LONG]-lo[LONG])/extent[LONG]*(W-1)).astype(np.int32)
v=np.floor((cp[:,SHORT]-lo[SHORT])/extent[SHORT]*(H-1)).astype(np.int32)
pix=v.astype(np.int64)*W+u
# Depth-sort each pixel; confidence suppresses one-off interpolated edge speckles.
eligible=confidence>.5
order=np.lexsort((cp[eligible,2],pix[eligible]))
epix=pix[eligible][order];er=cc[eligible][order]
last=np.r_[np.flatnonzero(epix[1:]!=epix[:-1]),len(epix)-1]
canvas=np.zeros((H*W,4),np.uint8);canvas[epix[last],:3]=er[last];canvas[epix[last],3]=255
canvas=canvas.reshape(H,W,4);mask=canvas[:,:,3]>0
dist,near=distance_transform_edt(~mask,return_indices=True)
fill=(dist<=3)&~mask
canvas[fill]=canvas[near[0][fill],near[1][fill]]
Image.fromarray(canvas).save(OUT/'base-map.webp',quality=92,method=5)
del canvas,mask,dist,near,fill,epix,er,last,order,pix,u,v

# Preserve spatial coverage using voxels, then deterministic density subsampling.
rng=np.random.default_rng(20261102)
env_key=voxel_key(cp,.10);_,ei=np.unique(env_key,return_index=True)
if len(ei)>1200000:ei=rng.choice(ei,1200000,False)
ep=normalize(cp[ei]);ec=cc[ei]
ep.astype('<f4').tofile(OUT/'environment-positions.bin');ec.tofile(OUT/'environment-colors.bin')

scan=np.concatenate(scans);del scans
sk=voxel_key(scan,.24);_,si=np.unique(sk,return_index=True)
if len(si)>320000:si=rng.choice(si,320000,False)
sp=normalize(scan[si]);sp.astype('<f4').tofile(OUT/'scan-positions.bin')

# Camera-space point rendering for an independently inspectable offline preview.
preview_p=normalize(cp);preview_p[:,1]-=.1
right=np.array([.78,0,-.625]);up=np.array([.285,.89,.355]);forward=np.cross(right,up)
view=np.column_stack((preview_p@right,preview_p@up,preview_p@forward))
vw,vh=3200,1800
zoom=min((vw-160)/np.ptp(view[:,0]),(vh-140)/np.ptp(view[:,1]))
uu=((view[:,0]-(view[:,0].min()+view[:,0].max())/2)*zoom+vw/2).astype(int)
vv=(-(view[:,1]-(view[:,1].min()+view[:,1].max())/2)*zoom+vh/2).astype(int)
pixel=vv.astype(np.int64)*vw+uu
order=np.lexsort((view[:,2],pixel));pixel=pixel[order];colors=cc[order]
last=np.r_[np.flatnonzero(pixel[1:]!=pixel[:-1]),len(pixel)-1]
preview=np.full((vh*vw,3),[8,15,23],np.uint8);pm=np.zeros(vh*vw,bool)
preview[pixel[last]]=colors[last];pm[pixel[last]]=True
preview=preview.reshape(vh,vw,3);pm=pm.reshape(vh,vw)
dist,near=distance_transform_edt(~pm,return_indices=True);fill=(dist<=1.5)&~pm
preview[fill]=preview[near[0][fill],near[1][fill]]
Image.fromarray(preview).save(OUT/'environment-preview.webp',quality=92)

route_ids=np.unique(np.r_[np.arange(0,len(poses),10),len(poses)-1])
route=normalize(poses[route_ids,1:4]);route[:,1]=.035
frame_ids=np.unique(np.linspace(0,len(poses)-1,32).astype(int));frames=[]
for i in frame_ids:
 im=Image.open(io.BytesIO(archive.read(f'2d_rect/cam0/{SEQ}/2d_rect_cam0_{SEQ}_{i}.png'))).convert('RGB');im.thumbnail((720,610),Image.Resampling.LANCZOS)
 name=f'frame-{i}.jpg';im.save(OUT/name,quality=87,optimize=True)
 frames.append({'image':name,'timestamp':f'{poses[i,0]:.6f}','frameIndex':int(i),'position':normalize(poses[i:i+1,1:4]).round(5).tolist()[0]})
route_m=float(np.linalg.norm(np.diff(poses[valid_pose,1:4],axis=0),axis=1).sum())
scene={'width':18,'depth':float(extent[SHORT]*scale),'sequence':SEQ,'extentMeters':[float(extent[LONG]),float(extent[SHORT])],'sourceFrameCount':len(poses),'sampledFrameCount':len(indices),'routeMeters':round(route_m,2),'positionsFile':'scan-positions.bin','pointCount':len(sp),'environment':{'positionsFile':'environment-positions.bin','colorsFile':'environment-colors.bin','pointCount':len(ep),'pointSize':.009,'colorSpace':'srgb','voxelMeters':.10},'route':route.round(5).tolist(),'frames':frames,'modality':'Recorded OS1 LiDAR + synchronized RGB + dense sensor poses','region':f'CODa sequence {SEQ} · complete {route_m/1000:.2f} km journey','baseMap':'base-map.webp','preview':'environment-preview.webp'}
(OUT/'scene.json').write_text(json.dumps(scene,separators=(',',':')))
prov={'dataset':'CODa','sequence':SEQ,'sourceArchive':str(ARCHIVE),'selection':'Largest daytime complete long-route archive among the supplied local sequences. Sequence 2 is a near-identical route at dusk; sequence 7 has clear daylight camera texture.','sourceFrameCount':len(poses),'sampledFrameCount':len(indices),'frameStride':args.step,'frameIndices':indices,'routeMeters':route_m,'trajectoryBoundsXY':{'min':poses[:,1:3].min(0).tolist(),'max':poses[:,1:3].max(0).tolist()},'trajectoryHullAreaM2':float(ConvexHull(poses[:,1:3]).volume),'worldBoundsXY':{'min':lo.tolist(),'max':hi.tolist()},'extentMeters':extent.tolist(),'rawInputPoints':int(totals[0]),'measuredColorPoints':int(totals[1]),'measuredAndSurfaceSamples':int(totals[2]),'fusedColorVoxelCount':len(cp),'environmentPointCount':len(ep),'scanPointCount':len(sp),'texturePixels':[W,H],'worldToRender':{'longAxis':LONG,'shortAxis':SHORT,'centerXY':center.tolist(),'groundZ':ground,'scale':scale,'heightScaleRelativeToXY':HEIGHT_SCALE},'colorPipeline':'Synchronized rectified cam0 RGB projected through the provided OS1-to-camera matrix; camera-space measured z-buffer visibility filtering; 7 cm voxel weighted multiview fusion. Additional RGB surface samples are perspective-correct interpolation inside short, depth-continuous measured LiDAR triangles, never beyond observed geometry.','rasterPipeline':'Highest visible colored surface per 8K orthographic pixel, with nearest raster splats capped to 3 pixels; transparent unobserved areas.','binaryLayout':{'positions':'little-endian float32 XYZ in common normalized scene coordinates','colors':'uint8 RGB in sRGB color space'},'limitations':['Ground-based sensors cannot recover unseen building roofs.','Moving objects and residual pose error can leave local ghosting.','Depth-continuous triangle samples add texture density, not additional measured LiDAR observations.','Elevation is compressed by 0.8 relative to horizontal scale for the layered display.'],'noGeneratedGeometry':True}
prov['excludedInvalidPoseFrameIndices']=np.flatnonzero(~valid_pose).tolist()
(OUT/'provenance.json').write_text(json.dumps(prov,indent=2))
print('DONE',json.dumps({'sequence':SEQ,'sourceFrames':len(poses),'sampledFrames':len(indices),'fusedPoints':len(cp),'environmentPoints':len(ep),'scanPoints':len(sp),'extent':extent.tolist(),'assetsMB':sum(p.stat().st_size for p in OUT.iterdir())/1e6,'seconds':round(time.monotonic()-started)}),flush=True)
