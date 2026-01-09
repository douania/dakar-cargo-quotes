import { useRef, useState } from 'react';
import { Edges, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CargoItem3DProps {
  itemId: string;
  position: { x: number; y: number; z: number }; // Position du CENTRE en mètres (déjà calculée)
  dimensions: { width: number; height: number; length: number }; // Dimensions en mètres (rotation déjà appliquée)
  color: string;
  isSelected: boolean;
  isVisible: boolean;
  onClick: () => void;
}

export function CargoItem3D({
  itemId,
  position,
  dimensions,
  color,
  isSelected,
  isVisible,
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

  // Les dimensions et positions sont déjà correctement calculées par TruckScene3D
  // width = dimension sur X (largeur), length = dimension sur Z (profondeur), height = dimension sur Y (hauteur)
  const w = dimensions.width;
  const l = dimensions.length;
  const h = dimensions.height;

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[position.x, position.y, position.z]}
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
          position={[position.x, position.y + h / 2 + 0.15, position.z]}
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
