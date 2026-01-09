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
  const posX = width / 2;
  const posY = height / 2;
  const posZ = length / 2;

  return (
    <group>
      {/* Main container box (transparent) */}
      <mesh ref={meshRef} position={[posX, posY, posZ]}>
        <boxGeometry args={[width, height, length]} />
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
        <planeGeometry args={[width, length, Math.ceil(width), Math.ceil(length)]} />
        <meshBasicMaterial 
          color="#e2e8f0" 
          wireframe 
          transparent 
          opacity={0.5}
        />
      </mesh>

      {/* Floor solid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[posX, 0, posZ]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#f1f5f9" />
      </mesh>

      {/* Dimension labels */}
      <Text
        position={[posX, -0.3, length + 0.3]}
        fontSize={0.25}
        color="#64748b"
        anchorX="center"
      >
        {`${length.toFixed(1)}m`}
      </Text>
      <Text
        position={[width + 0.3, -0.3, posZ]}
        fontSize={0.25}
        color="#64748b"
        anchorX="center"
        rotation={[0, Math.PI / 2, 0]}
      >
        {`${width.toFixed(1)}m`}
      </Text>
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
      {[[0, 0], [width, 0], [0, length], [width, length]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0, z]}>
          <cylinderGeometry args={[0.05, 0.05, height, 8]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}
