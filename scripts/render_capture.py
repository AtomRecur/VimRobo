"""Render measured CODa sequence 0 geometry; source files are never changed.
Run on re_debug2 using its existing /data/anaconda3/bin/python.
No learned/invented geometry, inpainting, or external services are used.
"""
from pathlib import Path
import json, numpy as np, yaml
from PIL import Image, ImageDraw
from scipy.spatial.transform import Rotation
from scipy.ndimage import distance_transform_edt

RAW=Path('/data/qiuchen_shared/roboagent/data/coda/raw')
OUT=Path('/data/users/wangqiuchen/vimrobo_web_render_20261102/assets')
OUT.mkdir(parents=True,exist_ok=True)
poses=np.loadtxt(RAW/'poses/dense/0.txt')
projection=np.array(yaml.safe_load(open(RAW/'calibrations/0/calib_os1_to_cam0.yaml'))['projection_matrix']['data']).reshape(3,4)
indices=list(range(800,1561,40))+list(range(6600,7361,40))
# 60 x 40 m rectangle containing the intersection, facades, and tree-lined path.
center=np.array([-49.,57.]); extent=np.array([60.,40.]); ground=-3.55
clouds=[]; colors=[]; colored=[]
for i in indices:
    p=np.fromfile(RAW/f'3d_comp/os1/0/3d_comp_os1_0_{i}.bin',dtype=np.float32).reshape(128*1024,-1)[:,:3]
    mask=np.isfinite(p).all(1)&(np.linalg.norm(p,axis=1)>1.2)&(np.linalg.norm(p,axis=1)<65)
    p=p[mask]
    rotation=Rotation.from_quat(poses[i,[5,6,7,4]]).as_matrix()
    world=p@rotation.T+poses[i,1:4]
    keep=(np.abs(world[:,:2]-center)<extent/2).all(1)&(world[:,2]>ground-.25)&(world[:,2]<ground+15.5)
    p=p[keep];world=world[keep]
    im=np.asarray(Image.open(RAW/f'2d_rect/cam0/0/2d_rect_cam0_0_{i}.png').convert('RGB'))
    proj=np.column_stack((p,np.ones(len(p))))@projection.T
    uv=(proj[:,:2]/np.maximum(proj[:,2,None],1e-6)).astype(int)
    good=(proj[:,2]>.5)&(uv[:,0]>=0)&(uv[:,0]<im.shape[1])&(uv[:,1]>=0)&(uv[:,1]<im.shape[0])
    rgb=np.zeros((len(p),3),np.uint8)+[71,80,76]
    rgb=rgb.astype(np.uint8)
    rgb[good]=im[uv[good,1],uv[good,0]]
    clouds.append(world.astype(np.float32));colors.append(rgb);colored.append(good)
    print('frame',i,'region points',len(p),'RGB',int(good.sum()),flush=True)
xyz=np.concatenate(clouds);rgb=np.concatenate(colors);has=np.concatenate(colored)
print('combined',len(xyz),'colored',has.sum(),flush=True)
# First choose one colored observation per 5 cm voxel; unobserved cells remain dark.
colored_xyz=xyz[has];colored_rgb=rgb[has]
voxel=np.floor(colored_xyz/.05).astype(np.int32)
_,idx=np.unique(voxel,axis=0,return_index=True)
cp=colored_xyz[idx];cc=colored_rgb[idx]
W,H=1536,1024
u=((cp[:,0]-center[0]+extent[0]/2)/extent[0]*(W-1)).astype(int)
v=((center[1]+extent[1]/2-cp[:,1])/extent[1]*(H-1)).astype(int)
# Topmost colored measured surface wins at each pixel.
order=np.argsort(cp[:,2]);u=u[order];v=v[order];cc=cc[order]
canvas=np.full((H,W,3),[22,33,32],dtype=np.uint8); mask=np.zeros((H,W),bool)
canvas[v,u]=cc;mask[v,u]=True
# Tiny raster splats, capped to 3 px (~12 cm), never fill large missing regions.
dist,nearest=distance_transform_edt(~mask,return_indices=True)
fill=(dist<=3)&~mask
canvas[fill]=canvas[nearest[0][fill],nearest[1][fill]]
Image.fromarray(canvas).save(OUT/'base-map.webp',quality=92,method=6)
# Voxel sampling preserves facades / trunks without shipping millions of points.
vox=np.floor(xyz/.17).astype(np.int32)
_,idx=np.unique(vox,axis=0,return_index=True)
if len(idx)>48000: idx=np.random.default_rng(42).choice(idx,48000,replace=False)
sample=xyz[idx]
def normalized(points):
    a=np.asarray(points);return np.column_stack(((a[:,0]-center[0])*.2,(a[:,2]-ground)*.1,-(a[:,1]-center[1])*.2))
pts=normalized(sample);pts[:,1]=np.maximum(pts[:,1],.015)
route_indices=[i for i in range(800,1561,20) if (np.abs(poses[i,1:3]-center)<extent/2).all()]
route=normalized(poses[route_indices,1:4]);route[:,1]=.035
frames=[]
for j,i in enumerate([840,1000,1360,6720,7000,7280]):
    im=Image.open(RAW/f'2d_rect/cam0/0/2d_rect_cam0_0_{i}.png').convert('RGB');im.thumbnail((640,540))
    name=f'frame-{i}.jpg';im.save(OUT/name,quality=86)
    frames.append({'image':name,'timestamp':f'{poses[i,0]:.6f}','frameIndex':i,'position':normalized(poses[i:i+1,1:4]).round(4).tolist()[0]})
scene={'width':12,'depth':8,'positions':[round(float(v),4) for v in pts.ravel()],'route':route.round(4).tolist(),'frames':frames,'pointCount':len(pts),'modality':'Recorded OS1 LiDAR + synchronized RGB + sensor poses','region':'CODa sequence 0 · campus intersection','baseMap':'base-map.webp'}
(OUT/'scene.json').write_text(json.dumps(scene,separators=(',',':')))
prov={'dataset':'CODa','sequence':0,'source':'nav_benchmark/frames/0 and its corresponding coda/raw files','modality':'OS1 motion-compensated LiDAR, rectified cam0 RGB, dense LiDAR poses','frame_indices':indices,'source_paths':{'pointcloud':'3d_comp/os1/0/3d_comp_os1_0_{index}.bin','camera':'2d_rect/cam0/0/2d_rect_cam0_0_{index}.png','poses':'poses/dense/0.txt','projection':'calibrations/0/calib_os1_to_cam0.yaml'},'transform':{'world_to_render':['(world_x + 49) * 0.2','max(0.015, (world_z + 3.55) * 0.1)','-(world_y - 57) * 0.2'],'world_rectangle_center_xy':center.tolist(),'world_rectangle_m':extent.tolist(),'height_display_scale_relative_to_xy':0.5,'point_frame':'sensor XYZ -> pose quaternion [qx,qy,qz,qw] rotation + translation -> crop -> normalized render coordinates'},'point_count':len(pts),'input_points_in_crop':len(xyz),'colored_input_points':int(has.sum()),'raster':'1536x1024 orthographic top-down render of highest colored surface; nearest splats limited to 3 pixels (~12 cm). Dark areas have no colored measurements. No satellite, aerial, or generated photo.','limitations':['Sparse ground-based sampling cannot recover unseen roof surfaces.','Moving objects and residual pose error may leave ghosting.','Camera colors use projected LiDAR samples; no learned texture completion.','Vertical scale is compressed by 0.5 for stacked presentation.','Top reasoning layer and QA remain an authored teaching trace, separate from this recorded example.']}
(OUT/'provenance.json').write_text(json.dumps(prov,indent=2))
preview=Image.new('RGB',(1536,1500),(14,27,28));preview.paste(Image.fromarray(canvas),(0,0))
d=ImageDraw.Draw(preview)
for j,f in enumerate(frames):
    im=Image.open(OUT/f['image']);im.thumbnail((500,210));x=(j%3)*512;y=1030+(j//3)*235;preview.paste(im,(x,y));d.text((x+8,y+212),f['image'],fill='white')
preview.save(OUT/'preview.jpg',quality=90)
print('DONE',OUT, 'points',len(pts),'bytes',sum(f.stat().st_size for f in OUT.iterdir()),flush=True)
