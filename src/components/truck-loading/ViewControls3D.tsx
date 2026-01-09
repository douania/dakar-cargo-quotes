import { Button } from '@/components/ui/button';
import { RotateCcw, Square, ArrowUp, ArrowRight, Box } from 'lucide-react';

interface ViewControls3DProps {
  onViewChange: (position: [number, number, number], target?: [number, number, number]) => void;
  containerDimensions: { length: number; width: number; height: number };
}

export function ViewControls3D({ onViewChange, containerDimensions }: ViewControls3DProps) {
  const { length, width, height } = containerDimensions;
  const centerX = width / 2;
  const centerY = height / 2;
  const centerZ = length / 2;
  
  const distance = Math.max(length, width, height) * 1.5;

  const views = [
    {
      label: 'Face',
      icon: Square,
      position: [centerX, centerY, length + distance] as [number, number, number],
      target: [centerX, centerY, centerZ] as [number, number, number],
    },
    {
      label: 'Côté',
      icon: ArrowRight,
      position: [width + distance, centerY, centerZ] as [number, number, number],
      target: [centerX, centerY, centerZ] as [number, number, number],
    },
    {
      label: 'Dessus',
      icon: ArrowUp,
      position: [centerX, height + distance, centerZ] as [number, number, number],
      target: [centerX, 0, centerZ] as [number, number, number],
    },
    {
      label: 'Iso',
      icon: Box,
      position: [width + distance * 0.7, height + distance * 0.5, length + distance * 0.7] as [number, number, number],
      target: [centerX, centerY, centerZ] as [number, number, number],
    },
  ];

  return (
    <div className="absolute top-4 right-4 flex gap-1 z-10">
      {views.map((view) => (
        <Button
          key={view.label}
          variant="secondary"
          size="sm"
          className="bg-white/90 backdrop-blur-sm hover:bg-white shadow-sm"
          onClick={() => onViewChange(view.position, view.target)}
        >
          <view.icon className="h-4 w-4 mr-1" />
          {view.label}
        </Button>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="bg-white/90 backdrop-blur-sm hover:bg-white shadow-sm"
        onClick={() => {
          const defaultPos: [number, number, number] = [
            width + distance * 0.7,
            height + distance * 0.5,
            length + distance * 0.7,
          ];
          onViewChange(defaultPos, [centerX, centerY, centerZ]);
        }}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
    </div>
  );
}
