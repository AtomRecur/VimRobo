import { useMemo } from "react";
import { Billboard, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "../data/scenarios";

const box = new THREE.BoxGeometry(1, 1, 1);
const plane = new THREE.PlaneGeometry(1, 1);

function surface(
  atlas: THREE.Texture,
  tile: number,
  repeat: [number, number],
  color: string,
  bump = 0.012,
) {
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    bumpMap: atlas,
    bumpScale: bump,
    color,
    roughness: 0.9,
  });
  const x = tile % 2 ? 0.503 : 0.003,
    y = tile < 2 ? 0.503 : 0.003;
  material.onBeforeCompile = (shader) => {
    const uv = `vec2 atlasUv(vec2 uv) { return fract(uv * vec2(${repeat[0].toFixed(1)}, ${repeat[1].toFixed(1)})) * 0.494 + vec2(${x}, ${y}); }\n`;
    shader.fragmentShader = uv + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      THREE.ShaderChunk.map_fragment.replace(
        "texture2D( map, vMapUv )",
        `textureGrad( map, atlasUv(vMapUv), dFdx(vMapUv) * vec2(${repeat[0].toFixed(1)}, ${repeat[1].toFixed(1)}) * .494, dFdy(vMapUv) * vec2(${repeat[0].toFixed(1)}, ${repeat[1].toFixed(1)}) * .494 )`,
      ),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <bumpmap_pars_fragment>",
      THREE.ShaderChunk.bumpmap_pars_fragment
        .replace(
          "texture2D( bumpMap, vBumpMapUv )",
          "texture2D( bumpMap, atlasUv(vBumpMapUv) )",
        )
        .replace(
          "texture2D( bumpMap, vBumpMapUv + dSTdx )",
          "texture2D( bumpMap, atlasUv(vBumpMapUv + dSTdx) )",
        )
        .replace(
          "texture2D( bumpMap, vBumpMapUv + dSTdy )",
          "texture2D( bumpMap, atlasUv(vBumpMapUv + dSTdy) )",
        ),
    );
  };
  material.customProgramCacheKey = () =>
    `campus-atlas-${tile}-${repeat.join("-")}`;
  return material;
}

function Block({
  position,
  size,
  material,
  rotation = [0, 0, 0],
}: {
  position: Vec3;
  size: Vec3;
  material: THREE.Material;
  rotation?: Vec3;
}) {
  return (
    <mesh
      geometry={box}
      position={position}
      scale={size}
      material={material}
      rotation={rotation}
      castShadow
      receiveShadow
    />
  );
}

type Materials = ReturnType<typeof useMaterials>;
function useMaterials() {
  const [atlas, tree] = useTexture([
    "environment/campus-surfaces.png",
    "environment/campus-tree.png",
  ]);
  return useMemo(() => {
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 8;
    tree.colorSpace = THREE.SRGBColorSpace;
    tree.anisotropy = 4;
    return {
      concrete: surface(atlas, 0, [2, 2], "#dddcd2", 0.008),
      darker: surface(atlas, 0, [2, 2], "#aea79b", 0.01),
      asphalt: surface(atlas, 1, [7, 1], "#555955", 0.009),
      lawn: surface(atlas, 2, [50, 50], "#9caf95", 0.009),
      pavers: surface(atlas, 3, [4, 6], "#e8e4d8", 0.008),
      roof: surface(atlas, 0, [4, 4], "#8b918b", 0.012),
      glass: new THREE.MeshStandardMaterial({
        color: "#829c9c",
        roughness: 0.14,
        metalness: 0.82,
        envMapIntensity: 1.4,
      }),
      glassDark: new THREE.MeshStandardMaterial({
        color: "#445758",
        roughness: 0.17,
        metalness: 0.7,
        envMapIntensity: 1.1,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: "#3c4844",
        metalness: 0.75,
        roughness: 0.34,
      }),
      frame: new THREE.MeshStandardMaterial({
        color: "#babdb4",
        metalness: 0.55,
        roughness: 0.33,
      }),
      wood: new THREE.MeshStandardMaterial({
        color: "#80725c",
        roughness: 0.93,
      }),
      paint: new THREE.MeshStandardMaterial({
        color: "#d7d4ba",
        roughness: 1,
        transparent: true,
        opacity: 0.65,
      }),
      foliage: new THREE.MeshStandardMaterial({
        map: tree,
        alphaTest: 0.58,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0,
        color: "#b7c6ab",
      }),
      sign: new THREE.MeshStandardMaterial({
        color: "#375e68",
        roughness: 0.6,
      }),
    };
  }, [atlas, tree]);
}

function Office({
  position,
  size,
  m,
  variant = 0,
}: {
  position: Vec3;
  size: Vec3;
  m: Materials;
  variant?: number;
}) {
  const [w, h, d] = size;
  const floors = Math.round(h / 0.96);
  return (
    <group position={position}>
      <Block
        position={[0, h / 2, 0]}
        size={[w, h, d]}
        material={variant === 1 ? m.darker : m.concrete}
      />
      <Block
        position={[0, 0.09, 0]}
        size={[w + 0.15, 0.18, d + 0.15]}
        material={m.darker}
      />
      {Array.from({ length: floors }, (_, level) => {
        const y = 0.6 + level * 0.94;
        return (
          <group key={level}>
            <Block
              position={[0, y, d / 2 + 0.025]}
              size={[w - 0.32, 0.65, 0.025]}
              material={level % 2 ? m.glass : m.glassDark}
            />
            <Block
              position={[w / 2 + 0.025, y, 0]}
              size={[0.025, 0.65, d - 0.35]}
              material={m.glass}
            />
            <Block
              position={[-w / 2 - 0.025, y, 0]}
              size={[0.025, 0.65, d - 0.35]}
              material={m.glassDark}
            />
            <Block
              position={[0, y, -d / 2 - 0.025]}
              size={[w - 0.32, 0.65, 0.025]}
              material={m.glass}
            />
            {Array.from({ length: Math.floor(w / 0.43) }, (_, i) => (
              <Block
                key={i}
                position={[-w / 2 + 0.2 + i * 0.43, y, d / 2 + 0.045]}
                size={[0.027, 0.68, 0.04]}
                material={m.frame}
              />
            ))}
            {Array.from({ length: Math.floor(d / 0.43) }, (_, i) => (
              <Block
                key={i}
                position={[w / 2 + 0.045, y, -d / 2 + 0.2 + i * 0.43]}
                size={[0.04, 0.68, 0.027]}
                material={m.frame}
              />
            ))}
            <Block
              position={[0, y - 0.38, d / 2 + 0.1]}
              size={[w + 0.04, 0.06, 0.24]}
              material={m.concrete}
            />
            <Block
              position={[w / 2 + 0.08, y - 0.38, 0]}
              size={[0.2, 0.06, d]}
              material={m.concrete}
            />
          </group>
        );
      })}
      <Block
        position={[0, h + 0.04, 0]}
        size={[w + 0.12, 0.1, d + 0.12]}
        material={m.concrete}
      />
      <Block
        position={[0, h + 0.1, 0]}
        size={[w - 0.2, 0.04, d - 0.2]}
        material={m.roof}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Block
            position={[side * (w / 2 - 0.045), h + 0.18, 0]}
            size={[0.09, 0.2, d]}
            material={m.concrete}
          />
          <Block
            position={[0, h + 0.18, side * (d / 2 - 0.045)]}
            size={[w, 0.2, 0.09]}
            material={m.concrete}
          />
        </group>
      ))}
      {[0, 1].map((i) => (
        <group key={i} position={[-w * 0.25 + i * 0.7, h + 0.22, -d * 0.22]}>
          <Block
            position={[0, 0, 0]}
            size={[0.48, 0.24, 0.7]}
            material={m.frame}
          />
          {[0, 1, 2, 3, 4].map((j) => (
            <Block
              key={j}
              position={[0, 0.13, -0.27 + j * 0.13]}
              size={[0.42, 0.015, 0.045]}
              material={m.metal}
            />
          ))}
        </group>
      ))}
      {variant === 0 && (
        <>
          <Block
            position={[0.45, 0.7, d / 2 + 0.07]}
            size={[0.83, 1.38, 0.05]}
            material={m.glassDark}
          />
          <Block
            position={[0.45, 0.72, d / 2 + 0.105]}
            size={[0.035, 1.35, 0.04]}
            material={m.frame}
          />
          <Block
            position={[0.45, 1.46, d / 2 + 0.55]}
            size={[1.3, 0.07, 1.15]}
            material={m.metal}
          />
          <Block
            position={[1.05, 0.97, d / 2 + 0.12]}
            size={[0.2, 0.24, 0.03]}
            material={m.sign}
          />
          <Block
            position={[0.45, 0.03, d / 2 + 0.55]}
            size={[1.3, 0.06, 1.1]}
            material={m.pavers}
          />
        </>
      )}
    </group>
  );
}

function Tree({
  position,
  height,
  m,
}: {
  position: Vec3;
  height: number;
  m: Materials;
}) {
  return (
    <group position={position}>
      <Billboard follow lockX lockZ position={[0, height / 2, 0]}>
        <mesh
          geometry={plane}
          scale={[height * 0.67, height, 1]}
          material={m.foliage}
          castShadow
          receiveShadow
        />
      </Billboard>
    </group>
  );
}
function Bench({
  position,
  m,
  rotation = 0,
}: {
  position: Vec3;
  m: Materials;
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i}>
          <Block
            position={[0, 0.33, -0.15 + i * 0.07]}
            size={[0.95, 0.035, 0.052]}
            material={m.wood}
          />
          <Block
            position={[0, 0.46 + i * 0.045, -0.18]}
            size={[0.95, 0.033, 0.04]}
            material={m.wood}
          />
        </group>
      ))}
      {[-0.33, 0.33].map((x) => (
        <Block
          key={x}
          position={[x, 0.16, 0]}
          size={[0.04, 0.32, 0.36]}
          material={m.metal}
        />
      ))}
    </group>
  );
}

export default function RealisticCampus() {
  const m = useMaterials();
  const trees: Vec3[] = [
    [-6, 0, 2.4],
    [-5.5, 0, 0.6],
    [-6.2, 0, -1.7],
    [-7.4, 0, -4],
    [-4.2, 0, -5.8],
    [-1, 0, -6.3],
    [3.8, 0, -6],
    [6.2, 0, -4.4],
    [6.7, 0, -1.6],
    [6.3, 0, 1.3],
    [5.8, 0, 2.7],
    [-3.6, 0, 2.2],
    [-2, 0, 2.5],
    [-0.2, 0, 2.6],
    [-8.5, 0, 2],
    [-8, 0, -6],
    [8.7, 0, -5],
    [8, 0, 2.7],
    [-5.8, 0, 7.7],
    [5.8, 0, 7.5],
    [-9, 0, 7.2],
    [9.2, 0, 7.7],
  ];
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.07, 0]}
        receiveShadow
        material={m.lawn}
      >
        <planeGeometry args={[200, 200]} />
      </mesh>
      <Block
        position={[0, -0.015, 4.2]}
        size={[48, 0.045, 1.65]}
        material={m.asphalt}
      />
      <Block
        position={[0, 0.003, 3.26]}
        size={[48, 0.05, 0.2]}
        material={m.darker}
      />
      <Block
        position={[0, 0.003, 5.14]}
        size={[48, 0.05, 0.2]}
        material={m.darker}
      />
      <Block
        position={[0, 0.005, 2.85]}
        size={[17, 0.05, 0.65]}
        material={m.pavers}
      />
      <Block
        position={[1.6, 0.02, 0.25]}
        size={[1.45, 0.07, 5.9]}
        material={m.pavers}
      />
      <Block
        position={[-4.3, 0.005, -1.3]}
        size={[1.2, 0.05, 7.4]}
        material={m.pavers}
      />
      <Block
        position={[3.4, 0.01, -2.6]}
        size={[5.1, 0.05, 4.8]}
        material={m.pavers}
      />
      <Block
        position={[0, -0.015, -8]}
        size={[35, 0.045, 1.4]}
        material={m.asphalt}
      />
      <Block
        position={[8.3, -0.015, -1.9]}
        size={[1.4, 0.045, 13.6]}
        material={m.asphalt}
      />
      <Block
        position={[0, 0.005, -8.9]}
        size={[29, 0.05, 0.65]}
        material={m.pavers}
      />
      <Block
        position={[2, 0.005, -10]}
        size={[1.2, 0.05, 2.5]}
        material={m.pavers}
      />
      <Block
        position={[-8, 0.005, -9.8]}
        size={[1.2, 0.05, 2.2]}
        material={m.pavers}
      />
      {Array.from({ length: 40 }, (_, i) => (
        <Block
          key={i}
          position={[-19.5 + i, 0.013, 4.2]}
          size={[0.45, 0.006, 0.035]}
          material={m.paint}
        />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <Block
          key={i}
          position={[1.6, 0.018, 3.62 + i * 0.18]}
          size={[0.85, 0.006, 0.085]}
          material={m.paint}
        />
      ))}
      <Office position={[2.45, 0.04, -2.35]} size={[3.8, 2.8, 3.6]} m={m} />
      <Office
        position={[-1.8, 0.02, -3.25]}
        size={[2.65, 3.7, 2.8]}
        m={m}
        variant={1}
      />
      <Office
        position={[-1.5, 0.02, 0.25]}
        size={[2.7, 1.85, 2.45]}
        m={m}
        variant={2}
      />
      <Office
        position={[-6, 0.02, -3.4]}
        size={[2, 1.85, 2.5]}
        m={m}
        variant={2}
      />
      <Office
        position={[-8, 0.02, -12]}
        size={[4.8, 2.8, 3.5]}
        m={m}
        variant={1}
      />
      <Office
        position={[2, 0.02, -13]}
        size={[5.2, 2.8, 3.8]}
        m={m}
        variant={2}
      />
      <Office
        position={[10, 0.02, -10]}
        size={[3.8, 3.7, 4.2]}
        m={m}
        variant={1}
      />
      <Block
        position={[-0.1, 1.65, -2.4]}
        size={[0.7, 0.5, 1.2]}
        material={m.glass}
      />
      <Bench position={[-4.9, 0.05, 2.6]} m={m} rotation={Math.PI / 2} />
      <Bench position={[4.5, 0.05, 2.6]} m={m} />
      {trees.map((position, i) => (
        <Tree
          key={i}
          position={position}
          height={i < 11 ? 2.8 + (i % 3) * 0.3 : 2.1 + (i % 4) * 0.3}
          m={m}
        />
      ))}
      {[-3.5, -0.2, 3.8, 7].map((x) => (
        <group key={x} position={[x, 0, 3.2]}>
          <Block
            position={[0, 0.95, 0]}
            size={[0.035, 1.9, 0.035]}
            material={m.metal}
          />
          <Block
            position={[0.1, 1.91, 0]}
            size={[0.25, 0.035, 0.1]}
            material={m.frame}
          />
        </group>
      ))}
      {[0, 1, 2].map((i) => (
        <group
          key={i}
          position={[2.65 + i * 0.4, 0.23, 0.1]}
          rotation={[0, 0.2, 0]}
        >
          {[-0.2, 0.2].map((x) => (
            <mesh key={x} position={[x, 0, 0]} material={m.metal}>
              <torusGeometry args={[0.19, 0.012, 8, 28]} />
            </mesh>
          ))}
          <mesh position={[0, 0.05, 0]}>
            <torusGeometry args={[0.16, 0.012, 5, 3]} />
            <meshStandardMaterial
              color={i === 0 ? "#a13e2d" : "#536967"}
              metalness={0.6}
            />
          </mesh>
          <Block
            position={[0.14, 0.15, 0]}
            size={[0.025, 0.24, 0.025]}
            material={m.metal}
            rotation={[0, 0, 0.3]}
          />
          <Block
            position={[0.15, 0.28, 0]}
            size={[0.07, 0.025, 0.14]}
            material={m.metal}
          />
        </group>
      ))}
    </group>
  );
}
