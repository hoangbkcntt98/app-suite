import { memo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, RoundedBox, Text } from '@react-three/drei';
import type { Group } from 'three';
import { agents } from '../data/agents';
import { Characters } from './Character';

const flowers = ['#f2a9a8', '#f5d878', '#a9c7ec', '#e4a6c5'];

function House({ x, z, color, label, index }: { x: number; z: number; color: string; label: string; index: number }) {
  const roofs = ['#d79b79', '#83aaa0', '#c2a071', '#9e93b7', '#d88991', '#7fa2bd'];
  return (
    <group position={[x, 0, z]}>
      <RoundedBox args={[1.65, 1.18, 1.5]} radius={0.12} smoothness={3} position={[0, 0.64, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.92} />
      </RoundedBox>
      <mesh position={[0, 1.42, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[1.15, 0.8, 4]} />
        <meshStandardMaterial color={roofs[index]} roughness={0.9} />
      </mesh>
      <RoundedBox args={[0.38, 0.58, 0.08]} radius={0.06} smoothness={2} position={[0, 0.32, 0.76]}>
        <meshStandardMaterial color="#9b725f" roughness={0.9} />
      </RoundedBox>
      <mesh position={[-0.48, 0.76, 0.76]}>
        <circleGeometry args={[0.15, 20]} />
        <meshStandardMaterial color="#cde8dc" emissive="#789c81" emissiveIntensity={0.12} />
      </mesh>
      <Text position={[0, 1.98, 0]} fontSize={0.16} color="#51495b" anchorX="center" outlineWidth={0.012} outlineColor="#fffaf4">
        {label}
      </Text>
    </group>
  );
}

function Tree({ x, z, scale = 1, phase = 0 }: { x: number; z: number; scale?: number; phase?: number }) {
  const tree = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (tree.current) tree.current.rotation.z = Math.sin(clock.elapsedTime * 0.65 + phase) * 0.018;
  });
  return (
    <group ref={tree} position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 1.25, 8]} />
        <meshStandardMaterial color="#9c755e" roughness={1} />
      </mesh>
      <mesh position={[0, 1.53, 0]} scale={[1, 1.14, 1]} castShadow>
        <sphereGeometry args={[0.72, 12, 10]} />
        <meshStandardMaterial color="#86b794" roughness={0.95} />
      </mesh>
      <mesh position={[0.4, 1.28, 0.12]} scale={0.72} castShadow>
        <sphereGeometry args={[0.62, 12, 10]} />
        <meshStandardMaterial color="#a3c998" roughness={0.95} />
      </mesh>
      <mesh position={[-0.38, 1.3, -0.1]} scale={0.7} castShadow>
        <sphereGeometry args={[0.62, 12, 10]} />
        <meshStandardMaterial color="#9dc694" roughness={0.95} />
      </mesh>
    </group>
  );
}

function Bush({ x, z, tint = '#9bc69b', phase = 0 }: { x: number; z: number; tint?: string; phase?: number }) {
  const bush = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (bush.current) bush.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + phase) * 0.025;
  });
  return (
    <group ref={bush} position={[x, 0, z]}>
      {[-0.24, 0, 0.24].map((offset, i) => (
        <mesh key={i} position={[offset, 0.28 + (i === 1 ? 0.08 : 0), 0]} scale={i === 1 ? 0.42 : 0.34} castShadow>
          <sphereGeometry args={[0.7, 12, 10]} />
          <meshStandardMaterial color={tint} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function FlowerPatch({ x, z, seed }: { x: number; z: number; seed: number }) {
  const flowersRef = useRef<Group>(null);
  const color = flowers[seed % flowers.length];
  useFrame(({ clock }) => {
    if (flowersRef.current) flowersRef.current.rotation.z = Math.sin(clock.elapsedTime * 1.1 + seed) * 0.045;
  });
  return (
    <group ref={flowersRef} position={[x, 0, z]}>
      {[0, 1, 2].map((i) => {
        const dx = (i - 1) * 0.2;
        return (
          <group key={i} position={[dx, 0, (seed % 2 ? 1 : -1) * (i % 2) * 0.13]}>
            <mesh position={[0, 0.12, 0]}>
              <cylinderGeometry args={[0.018, 0.025, 0.24, 5]} />
              <meshStandardMaterial color="#648f67" />
            </mesh>
            <mesh position={[0, 0.25, 0]}>
              <sphereGeometry args={[0.075, 8, 6]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Workstation({ x, z, accent, index, agentId }: { x: number; z: number; accent: string; index: number; agentId: string }) {
  const hasScreen = agentId === 'pip' || agentId === 'foxy' || agentId === 'ollie';
  const hasPlanningBoard = agentId === 'mochi' || agentId === 'luna';
  return (
    <group position={[x, 0, z]} rotation={[0, index % 2 ? -0.22 : 0.22, 0]}>
      <RoundedBox args={[1.02, 0.12, 0.62]} radius={0.06} smoothness={2} position={[0, 0.67, 0]} castShadow>
        <meshStandardMaterial color="#d8b894" roughness={0.88} />
      </RoundedBox>
      {[-0.38, 0.38].map((leg) => (
        <mesh key={leg} position={[leg, 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.045, 0.58, 7]} />
          <meshStandardMaterial color="#a9866b" roughness={0.9} />
        </mesh>
      ))}
      {hasScreen ? <>
        <RoundedBox args={[0.48, 0.32, 0.055]} radius={0.035} smoothness={2} position={[0, 0.92, -0.19]}>
          <meshStandardMaterial color={accent} roughness={0.7} />
        </RoundedBox>
        <mesh position={[0, 0.92, -0.15]}>
          <planeGeometry args={[0.37, 0.21]} />
          <meshBasicMaterial color="#d9eee6" />
        </mesh>
      </> : null}
      {hasPlanningBoard ? <>
        <RoundedBox args={[0.48, 0.42, 0.055]} radius={0.035} smoothness={2} position={[0, 0.92, -0.19]}>
          <meshStandardMaterial color="#e7d6bb" roughness={0.9} />
        </RoundedBox>
        {[-0.11, 0.02, 0.14].map((offset, card) => (
          <mesh key={offset} position={[offset, 0.95 + (card % 2) * 0.1, -0.151]}>
            <planeGeometry args={[0.09, 0.1]} />
            <meshBasicMaterial color={['#f3c5ba', '#e9df9d', '#c1ddcb'][card]} />
          </mesh>
        ))}
      </> : null}
      {agentId === 'bobo' ? <group position={[0, 0.92, -0.19]}>
        <RoundedBox args={[0.42, 0.36, 0.055]} radius={0.025} smoothness={2}>
          <meshStandardMaterial color="#f4ead8" roughness={0.9} />
        </RoundedBox>
        {[-0.08, 0.04, 0.16].map((offset) => (
          <mesh key={offset} position={[-0.1, offset, 0.035]}>
            <boxGeometry args={[0.045, 0.045, 0.015]} />
            <meshBasicMaterial color="#b9c6ab" />
          </mesh>
        ))}
      </group> : null}
      {agentId === 'foxy' && [-0.25, -0.12].map((offset, book) => (
        <RoundedBox key={offset} args={[0.12, 0.18 + book * 0.04, 0.1]} radius={0.02} smoothness={1} position={[offset, 0.81, 0.12]}>
          <meshStandardMaterial color={book ? '#d89484' : '#78aaa0'} roughness={0.9} />
        </RoundedBox>
      ))}
      <mesh position={[0.34, 0.78, 0.12]}>
        <cylinderGeometry args={[0.09, 0.09, 0.12, 12]} />
        <meshStandardMaterial color="#f2e3c9" />
      </mesh>
      <mesh position={[0.34, 0.88, 0.12]}>
        <cylinderGeometry args={[0.07, 0.07, 0.09, 12]} />
        <meshStandardMaterial color={index % 2 ? '#91b99a' : '#d99590'} />
      </mesh>
    </group>
  );
}

const VillageGeometry = memo(function VillageGeometry() {
  return (
    <>
      <RoundedBox args={[27, 0.35, 23]} radius={0.7} smoothness={4} position={[0, -0.22, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#b9d4b2" roughness={0.96} />
      </RoundedBox>
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2, 20]} />
        <meshStandardMaterial color="#e8ddc7" roughness={1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[17, 1.65]} />
        <meshStandardMaterial color="#e8ddc7" roughness={1} />
      </mesh>
      {agents.map((agent) => (
        <mesh key={`station-pad-${agent.id}`} position={[agent.work.x, 0.018, agent.work.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[1.18, 32]} />
          <meshStandardMaterial color={agent.color} roughness={0.98} />
        </mesh>
      ))}
      {agents.map((agent, i) => (
        <House
          key={agent.id}
          x={agent.home.x}
          z={agent.home.z + (agent.home.z < 0 ? -1.75 : 1.75)}
          color={agent.color}
          label={`${agent.name}'s home`}
          index={i}
        />
      ))}
      {agents.map((agent, i) => (
        <Workstation key={`desk-${agent.id}`} x={agent.work.x} z={agent.work.z} accent={agent.color} index={i} agentId={agent.id} />
      ))}
      {[
        [-11, -8], [-7, -9.5], [7, -9.5], [11, -8],
        [-11, 8], [-7, 9.5], [7, 9.5], [11, 8],
      ].map(([x, z], i) => <Tree key={`tree-${i}`} x={x} z={z} phase={i * 0.7} scale={0.78 + (i % 3) * 0.1} />)}
      {[
        [-8.5, 0], [8.5, 0], [-5, 7.2], [5, -7.2],
      ].map(([x, z], i) => <Bush key={`bush-${i}`} x={x} z={z} phase={i * 1.2} tint={i % 2 ? '#a5c995' : '#8dbb91'} />)}
      {Array.from({ length: 8 }, (_, i) => (
        <FlowerPatch key={`flowers-${i}`} x={-7.5 + (i % 4) * 5} z={i < 4 ? -7 : 7} seed={i} />
      ))}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.05, 32]} />
        <meshStandardMaterial color="#f0d6bc" roughness={0.96} />
      </mesh>
      <Text position={[0, 0.08, 0]} fontSize={0.17} color="#67516e" anchorX="center" outlineWidth={0.01} outlineColor="#f7ecdc">
        TEAM
      </Text>
    </>
  );
});

const IsometricCamera = memo(function IsometricCamera() {
  const { size } = useThree();
  const aspect = size.width / Math.max(size.height, 1);
  const visibleHeight = Math.max(36, 48 / aspect);
  const zoom = size.height / visibleHeight;
  return (
    <>
      <OrthographicCamera
        makeDefault
        position={[25, 30, 31]}
        zoom={zoom}
        near={0.1}
        far={120}
        onUpdate={(camera) => camera.lookAt(0, 0.55, 0)}
      />
      <OrbitControls
        makeDefault
        target={[0, 0.55, 0]}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.12}
        maxPolarAngle={Math.PI * 0.42}
        minZoom={zoom * 0.72}
        maxZoom={zoom * 1.65}
      />
    </>
  );
});

export function Village({ liveStatuses = {} }: { liveStatuses?: Record<string, string> }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      onPointerMissed={() => {}}
    >
      <IsometricCamera />
      <color attach="background" args={['#e7eef1']} />
      <hemisphereLight args={['#fff8e8', '#819b7c', 1.1]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[7, 14, 8]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <VillageGeometry />
      <Characters liveStatuses={liveStatuses} />
    </Canvas>
  );
}
