import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Uploaded3DModelInfo, ModelMaterialInfo } from '../types';

export interface Parsed3DModelResult {
  info: Uploaded3DModelInfo;
  group: THREE.Group;
}

/**
 * Parses user-uploaded 3D model file (GLB, GLTF, OBJ, STL)
 * Auto-centers, normalizes scale to fit the 3D studio, and analyzes materials/meshes.
 */
export async function parseUploaded3DModel(
  file: File,
  canvasTexture: THREE.CanvasTexture
): Promise<Parsed3DModelResult> {
  const fileName = file.name.toLowerCase();
  const fileExt = fileName.split('.').pop() || '';
  const arrayBuffer = await file.arrayBuffer();

  const group = new THREE.Group();
  let meshCount = 0;
  let vertexCount = 0;
  const materialsList: ModelMaterialInfo[] = [];
  const materialNameSet = new Set<string>();

  const paintMaterial = new THREE.MeshStandardMaterial({
    map: canvasTexture,
    roughness: 0.45,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  if (fileExt === 'glb' || fileExt === 'gltf') {
    const gltfLoader = new GLTFLoader();
    const gltf = await new Promise<any>((resolve, reject) => {
      gltfLoader.parse(arrayBuffer, '', resolve, reject);
    });
    group.add(gltf.scene);
  } else if (fileExt === 'obj') {
    const text = new TextDecoder().decode(arrayBuffer);
    const objLoader = new OBJLoader();
    const obj = objLoader.parse(text);
    group.add(obj);
  } else if (fileExt === 'stl') {
    const stlLoader = new STLLoader();
    const geometry = stlLoader.parse(arrayBuffer);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, paintMaterial);
    group.add(mesh);
  } else {
    throw new Error(`Unsupported 3D file format: .${fileExt}. Please upload GLB, GLTF, OBJ, or STL.`);
  }

  // Traverse the loaded scene graph to inspect and enhance materials
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshCount++;

      if (mesh.geometry) {
        const count = mesh.geometry.attributes.position?.count || 0;
        vertexCount += count;

        // Ensure proper UVs exist for 2D painting mapping
        if (!mesh.geometry.attributes.uv) {
          // Generate cylindrical / planar projection UVs if missing
          const pos = mesh.geometry.attributes.position;
          const uvs = new Float32Array(pos.count * 2);
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            // Cylindrical / spherical UV mapping
            const u = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
            const v = 0.5 + Math.asin(Math.max(-1, Math.min(1, y / 10))) / Math.PI;
            uvs[i * 2] = u;
            uvs[i * 2 + 1] = v;
          }
          mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        }
      }

      // Material inspection and paint assignment
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          const matName = mat.name || `Material_${materialsList.length + 1}`;
          if (!materialNameSet.has(matName)) {
            materialNameSet.add(matName);
            let hexColor = '#FFFFFF';
            if ((mat as THREE.MeshStandardMaterial).color) {
              hexColor = '#' + (mat as THREE.MeshStandardMaterial).color.getHexString();
            }
            materialsList.push({
              name: matName,
              type: mat.type,
              color: hexColor,
              roughness: (mat as THREE.MeshStandardMaterial).roughness ?? 0.5,
              metalness: (mat as THREE.MeshStandardMaterial).metalness ?? 0.1,
              hasTexture: !!(mat as THREE.MeshStandardMaterial).map,
            });
          }

          // Attach paintable canvas texture map to material
          (mat as THREE.MeshStandardMaterial).map = canvasTexture;
          (mat as THREE.MeshStandardMaterial).needsUpdate = true;
        });
      } else {
        mesh.material = paintMaterial;
      }
    }
  });

  // Auto-center and normalize size to fit ~7.2 units in the studio
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const TARGET_SIZE = 7.2;
  const scale = TARGET_SIZE / maxDim;
  group.scale.setScalar(scale);

  // Center horizontally (X and Z) and place base on top of the studio pedestal (Y)
  // Pedestal top is at Y = -3.8. Center of model sits at Y = 0.
  const yOffset = -center.y * scale;
  group.position.set(-center.x * scale, yOffset, -center.z * scale);
  group.updateMatrixWorld(true);

  // Wrap in a parent group so position offset stays clean
  const wrapper = new THREE.Group();
  wrapper.name = 'custom3DModelWrapper';
  wrapper.add(group);

  const modelInfo: Uploaded3DModelInfo = {
    id: `custom_${Date.now()}`,
    name: file.name.replace(/\.[^/.]+$/, ''),
    fileName: file.name,
    meshCount,
    vertexCount,
    materials: materialsList,
  };

  return {
    info: modelInfo,
    group: wrapper,
  };
}
