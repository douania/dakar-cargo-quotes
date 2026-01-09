import { useRef, useState, useCallback, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { TruckContainer3D } from './TruckContainer3D';
import { CargoItem3D } from './CargoItem3D';
import { ViewControls3D } from './ViewControls3D';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Layers, Package } from 'lucide-react';
import { generateColorFromString, hslToHex } from '@/lib/colorUtils';
import { Placement, TruckSpec, PackingItem } from '@/types/truckLoading';

interface TruckScene3DProps {
  truckSpec: TruckSpec;
  placements: Placement[];
  items?: PackingItem[]; // Items originaux pour récupérer les dimensions réelles
}

// Helper pour récupérer les dimensions d'un item depuis la liste originale
function getItemDimensions(itemId: string, items: PackingItem[]): { length: number; width: number; height: number } | null {
  // item_id peut être "item_0", "item_1" ou le nom de l'article
  // Essayer d'abord par index (item_0 -> index 0)
  const indexMatch = itemId.match(/^item_(\d+)$/i);
  if (indexMatch) {
    const index = parseInt(indexMatch[1], 10);
    if (index >= 0 && index < items.length) {
      const item = items[index];
      // items sont en cm, on retourne en mm pour cohérence avec l'API
      return {
        length: item.length * 10,
        width: item.width * 10,
        height: item.height * 10,
      };
    }
  }
  
  // Sinon chercher par id ou description
  const item = items.find(i => i.id === itemId || i.description === itemId);
  if (item) {
    return {
      length: item.length * 10,
      width: item.width * 10,
      height: item.height * 10,
    };
  }
  
  return null;
}

function Scene({
  truckSpec,
  placements,
  items,
  visibleCount,
  selectedItemId,
  onSelectItem,
  cameraRef,
}: {
  truckSpec: TruckSpec;
  placements: Placement[];
  items: PackingItem[];
  visibleCount: number;
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  cameraRef: React.RefObject<THREE.PerspectiveCamera>;
}) {
  // Convert mm to meters for display
  const containerLength = truckSpec.length / 1000;
  const containerWidth = truckSpec.width / 1000;
  const containerHeight = truckSpec.height / 1000;

  const distance = Math.max(containerLength, containerWidth, containerHeight) * 1.5;

  return (
    <>
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        position={[
          containerWidth + distance * 0.7,
          containerHeight + distance * 0.5,
          containerLength + distance * 0.7,
        ]}
        fov={50}
      />
      <OrbitControls
        target={[containerWidth / 2, containerHeight / 2, containerLength / 2]}
        enablePan
        enableZoom
        enableRotate
        minDistance={2}
        maxDistance={50}
      />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-5, 10, -5]} intensity={0.3} />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[containerWidth / 2, -0.01, containerLength / 2]}>
        <planeGeometry args={[containerWidth + 4, containerLength + 4]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>

      {/* Truck container */}
      <TruckContainer3D
        length={containerLength}
        width={containerWidth}
        height={containerHeight}
      />

      {/* Cargo items */}
      {placements.slice(0, visibleCount).map((placement, idx) => {
        const color = hslToHex(generateColorFromString(placement.item_id));
        
        // Récupérer les dimensions réelles depuis:
        // 1. placement.dimensions (si présent)
        // 2. items originaux via item_id
        // 3. fallback
        let dims = placement.dimensions;
        if (!dims || (dims.length === 0 && dims.width === 0 && dims.height === 0)) {
          const itemDims = getItemDimensions(placement.item_id, items);
          if (itemDims) {
            dims = itemDims;
          } else {
            // Fallback raisonnable (1m x 1m x 1m en mm)
            dims = { length: 1000, width: 1000, height: 1000 };
          }
        }
        
        // Dimensions en mètres
        const dimWidth = dims.width / 1000;
        const dimLength = dims.length / 1000;
        const dimHeight = dims.height / 1000;
        
        // Mapping des axes API vers Three.js:
        // - API X (longueur du camion, 0→14000mm) → Three.js Z (profondeur)
        // - API Y (largeur du camion, 0→2500mm)  → Three.js X (largeur)
        // - API Z (hauteur, 0→2700mm)            → Three.js Y (hauteur)
        // Three.js positionne au centre du mesh, donc on ajoute la moitié de la dimension
        const posX = placement.position.y / 1000 + dimWidth / 2;   // API Y -> Three.js X (largeur)
        const posY = placement.position.z / 1000 + dimHeight / 2;  // API Z -> Three.js Y (hauteur)
        const posZ = placement.position.x / 1000 + dimLength / 2;  // API X -> Three.js Z (longueur)
        
        return (
          <CargoItem3D
            key={`${placement.item_id}-${idx}`}
            itemId={placement.item_id}
            position={{
              x: posX,
              y: posY,
              z: posZ,
            }}
            dimensions={{
              width: dimWidth,
              length: dimLength,
              height: dimHeight,
            }}
            color={color}
            isSelected={selectedItemId === `${placement.item_id}-${idx}`}
            isVisible={idx < visibleCount}
            rotated={placement.rotated}
            onClick={() => onSelectItem(`${placement.item_id}-${idx}`)}
          />
        );
      })}
    </>
  );
}

export function TruckScene3D({ truckSpec, placements, items = [] }: TruckScene3DProps) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const controlsRef = useRef<any>(null);
  const [visibleCount, setVisibleCount] = useState(placements.length);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Container dimensions in meters for view controls
  const containerDimensions = {
    length: truckSpec.length / 1000,
    width: truckSpec.width / 1000,
    height: truckSpec.height / 1000,
  };

  const handleViewChange = useCallback(
    (position: [number, number, number], target?: [number, number, number]) => {
      if (cameraRef.current) {
        cameraRef.current.position.set(...position);
        if (target) {
          cameraRef.current.lookAt(...target);
        }
      }
    },
    []
  );

  const handlePrevItem = () => {
    setVisibleCount((prev) => Math.max(1, prev - 1));
  };

  const handleNextItem = () => {
    setVisibleCount((prev) => Math.min(placements.length, prev + 1));
  };

  // Get selected item details with resolved dimensions
  const selectedPlacement = selectedItemId
    ? placements.find((p, idx) => `${p.item_id}-${idx}` === selectedItemId)
    : null;
  
  // Résoudre les dimensions pour l'affichage
  const selectedDimensions = selectedPlacement
    ? (selectedPlacement.dimensions || getItemDimensions(selectedPlacement.item_id, items) || { length: 0, width: 0, height: 0 })
    : null;

  // Get unique item types for legend
  const uniqueItems = Array.from(new Set(placements.map((p) => p.item_id)));

  return (
    <div className="relative">
      {/* 3D Canvas */}
      <div className="relative aspect-video bg-gradient-to-b from-sky-100 to-slate-200 rounded-lg overflow-hidden">
        <ViewControls3D
          onViewChange={handleViewChange}
          containerDimensions={containerDimensions}
        />

        <Canvas shadows>
          <Suspense fallback={null}>
            <Scene
              truckSpec={truckSpec}
              placements={placements}
              items={items}
              visibleCount={visibleCount}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
              cameraRef={cameraRef}
            />
          </Suspense>
        </Canvas>

        {/* Step-by-step controls */}
        <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevItem}
              disabled={visibleCount <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium flex items-center gap-1">
                  <Layers className="h-4 w-4" />
                  Chargement pas à pas
                </span>
                <span className="text-sm text-muted-foreground">
                  {visibleCount} / {placements.length} articles
                </span>
              </div>
              <Slider
                value={[visibleCount]}
                min={1}
                max={placements.length}
                step={1}
                onValueChange={([value]) => setVisibleCount(value)}
                className="w-full"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleNextItem}
              disabled={visibleCount >= placements.length}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Legend and selected item details */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Color legend */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="h-4 w-4" />
              Légende des articles
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex flex-wrap gap-2">
              {uniqueItems.map((itemId) => (
                <Badge
                  key={itemId}
                  variant="outline"
                  className="gap-1"
                  style={{
                    borderColor: hslToHex(generateColorFromString(itemId)),
                    backgroundColor: `${hslToHex(generateColorFromString(itemId))}20`,
                  }}
                >
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: hslToHex(generateColorFromString(itemId)) }}
                  />
                  {itemId}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Selected item details */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Détails article sélectionné</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            {selectedPlacement ? (
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Article:</span>{' '}
                  <span className="font-medium">{selectedPlacement.item_id}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Position:</span>{' '}
                  X={selectedPlacement.position.x.toFixed(0)}, Y=
                  {selectedPlacement.position.y.toFixed(0)}, Z=
                  {selectedPlacement.position.z.toFixed(0)} mm
                </p>
                <p>
                  <span className="text-muted-foreground">Dimensions:</span>{' '}
                  {selectedDimensions && (selectedDimensions.width > 0 || selectedDimensions.length > 0) ? (
                    <>
                      {selectedDimensions.width.toFixed(0)} ×{' '}
                      {selectedDimensions.length.toFixed(0)} ×{' '}
                      {selectedDimensions.height.toFixed(0)} mm
                    </>
                  ) : (
                    'Non disponible'
                  )}
                </p>
                <p>
                  <span className="text-muted-foreground">Rotation:</span>{' '}
                  {selectedPlacement.rotated ? 'Oui (90°)' : 'Non'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Cliquez sur un article dans la vue 3D pour voir ses détails
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
