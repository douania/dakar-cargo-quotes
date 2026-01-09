import { useRef, useState } from 'react';
import { Edges, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CargoItem3DProps {
  itemId: string;
  position: { x: number; y: number; z: number }; // in meters
  dimensions: { width: number; height: number; length: number }; // in meters
  color: string;
  isSelected: boolean;
  isVisible: boolean;
  rotated: boolean;
  onClick: () => void;
}

export function CargoItem3D({
  itemId,
  position,
  dimensions,
  color,
  isSelected,
  isVisible,
  rotated,
  onClick,
}: CargoItem3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Animation for selection
  useFrame(() => {
    if (meshRef.current) {
      const targetScale = isSelected ? 1.02 : 1;
      meshRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        0.1
      );
    }
  });

  if (!isVisible) return null;

  // Account for rotation
  const w = rotated ? dimensions.length : dimensions.width;
  const l = rotated ? dimensions.width : dimensions.length;
  const h = dimensions.height;

  // Position at center of the box (Three.js uses center origin)
  const posX = position.x + w / 2;
  const posY = position.z + h / 2; // Z in data = Y in Three.js (height)
  const posZ = position.y + l / 2;  // Y in data = Z in Three.js (depth)

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[posX, posY, posZ]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <boxGeometry args={[w, h, l]} />
        <meshStandardMaterial
          color={hovered ? '#fbbf24' : color}
          transparent
          opacity={isSelected ? 1 : 0.85}
        />
        <Edges 
          color={isSelected ? '#1e40af' : hovered ? '#f59e0b' : '#374151'} 
          lineWidth={isSelected ? 3 : 1.5}
        />
      </mesh>

      {/* Label on top of the box */}
      {(hovered || isSelected) && (
        <Html
          position={[posX, posY + h / 2 + 0.15, posZ]}
          center
          distanceFactor={8}
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded shadow-lg border text-xs whitespace-nowrap">
            <p className="font-semibold text-gray-800">{itemId}</p>
            <p className="text-gray-500">
              {(w * 100).toFixed(0)} × {(l * 100).toFixed(0)} × {(h * 100).toFixed(0)} cm
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}
