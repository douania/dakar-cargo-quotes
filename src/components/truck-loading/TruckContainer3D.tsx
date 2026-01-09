import { useRef } from 'react';
import { Edges, Text } from '@react-three/drei';
import * as THREE from 'three';

interface TruckContainer3DProps {
  length: number; // in meters
  width: number;  // in meters
  height: number; // in meters
}

export function TruckContainer3D({ length, width, height }: TruckContainer3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Container positioned so bottom-left-back corner is at origin
  // Convention Three.js: X = longueur camion, Y = hauteur, Z = largeur camion
  const posX = length / 2;
  const posY = height / 2;
  const posZ = width / 2;

  return (
    <group>
      {/* Main container box (transparent) */}
      <mesh ref={meshRef} position={[posX, posY, posZ]}>
        <boxGeometry args={[length, height, width]} />
        <meshStandardMaterial 
          color="#94a3b8"
          transparent 
          opacity={0.08}
          side={THREE.DoubleSide}
        />
        <Edges color="#64748b" lineWidth={2} />
      </mesh>

      {/* Floor grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[posX, 0.001, posZ]}>
        <planeGeometry args={[length, width, Math.ceil(length), Math.ceil(width)]} />
        <meshBasicMaterial 
          color="#e2e8f0" 
          wireframe 
          transparent 
          opacity={0.5}
        />
      </mesh>

      {/* Floor solid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[posX, 0, posZ]}>
        <planeGeometry args={[length, width]} />
        <meshStandardMaterial color="#f1f5f9" />
      </mesh>

      {/* Dimension labels */}
      {/* Label longueur sur l'axe X (côté long) */}
      <Text
        position={[posX, -0.3, width + 0.3]}
        fontSize={0.25}
        color="#64748b"
        anchorX="center"
      >
        {`${length.toFixed(1)}m`}
      </Text>
      {/* Label largeur sur l'axe Z (côté court) */}
      <Text
        position={[length + 0.3, -0.3, posZ]}
        fontSize={0.25}
        color="#64748b"
        anchorX="center"
        rotation={[0, Math.PI / 2, 0]}
      >
        {`${width.toFixed(1)}m`}
      </Text>
      {/* Label hauteur sur l'axe Y */}
      <Text
        position={[-0.3, posY, 0]}
        fontSize={0.25}
        color="#64748b"
        anchorX="center"
        rotation={[0, Math.PI / 2, Math.PI / 2]}
      >
        {`${height.toFixed(1)}m`}
      </Text>

      {/* Corner markers */}
      {[[0, 0], [length, 0], [0, width], [length, width]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0, z]}>
          <cylinderGeometry args={[0.05, 0.05, height, 8]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}
