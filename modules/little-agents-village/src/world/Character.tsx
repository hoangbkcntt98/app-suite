import { useEffect, useRef, type Ref } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import type { Group, Mesh } from 'three';
import { MeshStandardMaterial, SphereGeometry } from 'three';
import { agents, type AgentDefinition } from '../data/agents';
import { useWorld } from '../store/world';

const sphere = new SphereGeometry(1, 20, 16);
const ballMaterials = new Map<string, MeshStandardMaterial>();
const palette = {
  cream: '#fff4df', pink: '#ef9bb9', dark: '#393747', muzzle: '#fff5e7',
  orange: '#f39a5d', teal: '#63b7ad', yellow: '#f2cc69', lavender: '#b7a2db',
  green: '#8bbd8b', blue: '#729dd4', white: '#fffaf1', blush: '#e98ea1',
};

function Ball({
  position, scale, color, rotation,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}) {
  let material = ballMaterials.get(color);
  if (!material) {
    material = new MeshStandardMaterial({ color, roughness: 0.78 });
    ballMaterials.set(color, material);
  }
  return (
    <mesh
      geometry={sphere}
      material={material}
      position={position}
      scale={scale}
      rotation={rotation}
      castShadow
      dispose={null}
    >
    </mesh>
  );
}

function CharacterDetails({
  def,
  headRef,
  setEye,
}: {
  def: AgentDefinition;
  headRef: Ref<Group>;
  setEye: (node: Mesh | null, index: number) => void;
}) {
  const fox = def.species === 'fox';
  const bunny = def.species === 'rabbit';
  const cat = def.species === 'cat';
  const penguin = def.species === 'penguin';
  const bear = def.species === 'bear';
  const owl = def.species === 'owl';
  const fur = def.color;

  return (
    <>
      {/* Short body and feet keep each silhouette chibi-like. */}
      <group>
      <Ball position={[0, 0.52, 0]} scale={[0.34, 0.43, 0.29]} color={fur} />
      <Ball position={[-0.4, 0.5, 0.02]} scale={[0.13, 0.25, 0.14]} color={fur} />
      <Ball position={[0.4, 0.5, 0.02]} scale={[0.13, 0.25, 0.14]} color={fur} />

      {penguin ? (
        <Ball position={[0, 0.55, 0.28]} scale={[0.25, 0.29, 0.08]} color={palette.white} />
      ) : null}

      {/* Tail shapes sit behind body, with silhouettes unique to each species. */}
      {fox ? <Ball position={[0.08, 0.46, -0.43]} scale={[0.2, 0.22, 0.48]} color={palette.orange} rotation={[0.5, 0, -0.6]} /> : null}
      {fox ? <Ball position={[0.24, 0.32, -0.72]} scale={[0.14, 0.15, 0.2]} color={palette.muzzle} /> : null}
      {cat ? <Ball position={[0.43, 0.63, -0.27]} scale={[0.1, 0.1, 0.38]} color={fur} rotation={[0, 0, -0.8]} /> : null}
      {bear ? <Ball position={[0, 0.48, -0.33]} scale={[0.13, 0.13, 0.14]} color={palette.muzzle} /> : null}
      {def.id === 'mochi' && <Ball position={[0, 0.82, 0.3]} scale={[0.25, 0.08, 0.1]} color={palette.yellow} />}
      {def.id === 'foxy' && <Ball position={[0, 0.82, 0.29]} scale={[0.25, 0.08, 0.1]} color={palette.teal} />}
      {def.id === 'bobo' && <Ball position={[0, 0.82, 0.29]} scale={[0.25, 0.08, 0.1]} color={palette.green} />}
      {penguin && <Ball position={[0, 0.42, 0.34]} scale={[0.18, 0.2, 0.04]} color={palette.blue} />}
      </group>

      {/* Oversized head. */}
      <group ref={headRef} position={[0, 1.18, 0]}>
      <group position={[0, -1.18, 0]}>
      <Ball position={[0, 1.18, 0]} scale={[0.51, 0.48, 0.43]} color={fur} />

      {bunny && <>
        <Ball position={[-0.24, 1.72, 0]} scale={[0.13, 0.43, 0.13]} color={fur} rotation={[0, 0, -0.12]} />
        <Ball position={[0.24, 1.72, 0]} scale={[0.13, 0.43, 0.13]} color={fur} rotation={[0, 0, 0.12]} />
        <Ball position={[-0.24, 1.72, 0.115]} scale={[0.065, 0.31, 0.04]} color={palette.blush} />
        <Ball position={[0.24, 1.72, 0.115]} scale={[0.065, 0.31, 0.04]} color={palette.blush} />
      </>}
      {fox && <>
        <Ball position={[-0.33, 1.53, 0]} scale={[0.19, 0.24, 0.15]} color={palette.orange} rotation={[0, 0, -0.4]} />
        <Ball position={[0.33, 1.53, 0]} scale={[0.19, 0.24, 0.15]} color={palette.orange} rotation={[0, 0, 0.4]} />
        <Ball position={[0, 1.03, 0.35]} scale={[0.23, 0.16, 0.19]} color={palette.muzzle} />
        <Ball position={[0, 1.11, 0.5]} scale={[0.07, 0.05, 0.04]} color={palette.dark} />
      </>}
      {cat && <>
        <Ball position={[-0.34, 1.54, 0]} scale={[0.18, 0.25, 0.14]} color={fur} rotation={[0, 0, -0.4]} />
        <Ball position={[0.34, 1.54, 0]} scale={[0.18, 0.25, 0.14]} color={fur} rotation={[0, 0, 0.4]} />
        <Ball position={[0, 1.34, 0.42]} scale={[0.13, 0.09, 0.06]} color={palette.blush} />
      </>}
      {bear && <>
        <Ball position={[-0.38, 1.51, 0]} scale={[0.17, 0.17, 0.13]} color={fur} />
        <Ball position={[0.38, 1.51, 0]} scale={[0.17, 0.17, 0.13]} color={fur} />
        <Ball position={[0, 1.03, 0.37]} scale={[0.24, 0.16, 0.14]} color={palette.muzzle} />
        <Ball position={[0, 1.12, 0.49]} scale={[0.07, 0.05, 0.04]} color={palette.dark} />
      </>}
      {owl && <>
        <Ball position={[-0.34, 1.28, 0.27]} scale={[0.24, 0.26, 0.18]} color="#e9dcfa" />
        <Ball position={[0.34, 1.28, 0.27]} scale={[0.24, 0.26, 0.18]} color="#e9dcfa" />
        <Ball position={[0, 1.07, 0.44]} scale={[0.09, 0.11, 0.09]} color={palette.yellow} />
      </>}

      {/* Eye sockets, pupils, and catchlights. */}
      {[[-0.19, 1.22, 0.385], [0.19, 1.22, 0.385]].map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh ref={(node) => setEye(node, i)} scale={[0.105, 0.125, 0.045]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color={owl ? palette.white : palette.dark} roughness={0.3} />
          </mesh>
          <mesh position={[0.018, 0.018, 0.04]} scale={[0.035, 0.043, 0.022]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshBasicMaterial color="white" />
          </mesh>
        </group>
      ))}

      {!fox && !bear && !owl ? <Ball position={[0, 1.03, 0.43]} scale={[0.07, 0.045, 0.035]} color={palette.blush} /> : null}

      {/* Scarves, bow, glasses, and hoodie details. */}
      {def.id === 'luna' && <>
        <Ball position={[0, 1.57, 0.18]} scale={[0.1, 0.08, 0.07]} color={palette.lavender} />
        <Ball position={[-0.08, 1.57, 0.18]} scale={[0.08, 0.08, 0.07]} color={palette.lavender} />
        <Ball position={[0.08, 1.57, 0.18]} scale={[0.08, 0.08, 0.07]} color={palette.lavender} />
      </>}
      {(fox || owl) && <>
        <mesh position={[-0.19, 1.22, 0.45]}><torusGeometry args={[0.12, 0.018, 6, 20]} /><meshStandardMaterial color={palette.dark} /></mesh>
        <mesh position={[0.19, 1.22, 0.45]}><torusGeometry args={[0.12, 0.018, 6, 20]} /><meshStandardMaterial color={palette.dark} /></mesh>
        <mesh position={[0, 1.22, 0.45]}><boxGeometry args={[0.12, 0.025, 0.025]} /><meshStandardMaterial color={palette.dark} /></mesh>
      </>}
      {owl ? <Ball position={[-0.43, 0.68, 0]} scale={[0.16, 0.1, 0.19]} color={fur} rotation={[0, 0, -0.25]} /> : null}
      {owl ? <Ball position={[0.43, 0.68, 0]} scale={[0.16, 0.1, 0.19]} color={fur} rotation={[0, 0, 0.25]} /> : null}
      </group>
      </group>
    </>
  );
}

export function Character({ def, liveStatus }: { def: AgentDefinition; liveStatus?: string }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const legs = useRef<(Mesh | null)[]>([]);
  const eyes = useRef<(Mesh | null)[]>([]);
  const previousStatus = useRef('idle');
  const successPulse = useRef(0);
  const reducedMotion = useRef(false);
  const hovered = useRef(false);
  const status = useWorld((s) => s.snapshot.agents.find((a) => a.id === def.id)!.status);
  const speechText = useWorld((s) => s.snapshot.agents.find((a) => a.id === def.id)!.speech?.text ?? null);
  const speechTone = useWorld((s) => s.snapshot.agents.find((a) => a.id === def.id)!.speech?.tone ?? 'neutral');
  const selected = useWorld((s) => s.selected === def.id);
  const select = useWorld((s) => s.select);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion.current = media.matches; };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useFrame(({ clock }, delta) => {
    const group = root.current;
    const torso = body.current;
    const agent = useWorld.getState().snapshot.agents.find((item) => item.id === def.id);
    if (!group || !torso || !agent) return;
    const dt = Math.min(delta, 0.05);
    const time = clock.elapsedTime;
    const scale = hovered.current || selected ? 1.055 : 1;
    group.scale.setScalar(group.scale.x + (scale - group.scale.x) * (1 - Math.exp(-12 * dt)));
    const dx = agent.position.x - group.position.x;
    const dz = agent.position.z - group.position.z;
    const distance = Math.hypot(dx, dz);
    const walking = agent.status === 'walking' || distance > 0.07;
    group.position.x += dx * (1 - Math.exp(-8 * dt));
    group.position.z += dz * (1 - Math.exp(-8 * dt));
    if (distance > 0.02) {
      const yaw = Math.atan2(dx, dz);
      const yawDelta = Math.atan2(Math.sin(yaw - group.rotation.y), Math.cos(yaw - group.rotation.y));
      group.rotation.y += yawDelta * (1 - Math.exp(-7 * dt));
    }

    if (agent.status === 'success' && previousStatus.current !== 'success') successPulse.current = 1;
    previousStatus.current = agent.status;
    successPulse.current = Math.max(0, successPulse.current - dt * 2.4);

    const still = reducedMotion.current;
    const stride = walking && !still ? Math.sin(time * 12) : 0;
    const bounce = walking && !still ? Math.abs(stride) * 0.09 : 0;
    const pulse = !still ? successPulse.current : 0;
    torso.position.y = 0.02 + bounce + Math.sin(time * 2.2) * (still ? 0 : 0.025) + pulse * 0.24;
    torso.rotation.z = agent.status === 'working' && !still ? Math.sin(time * 4.8) * 0.045 : Math.sin(time * 1.2) * (still ? 0 : 0.018);
    if (head.current) {
      head.current.rotation.z = !still && agent.status === 'thinking' ? 0.12 : !still && agent.status === 'error' ? -0.1 : Math.sin(time * 0.8) * (still ? 0 : 0.025);
      head.current.rotation.x = agent.status === 'working' && !still ? Math.sin(time * 5) * 0.035 : 0;
    }
    legs.current.forEach((leg, index) => {
      if (!leg) return;
      leg.rotation.x = stride * (index % 2 === 0 ? 0.65 : -0.65);
    });
    eyes.current.forEach((eye, index) => {
      if (!eye) return;
      const blink = !still && time % 4.7 > 4.61 && time % 4.7 < 4.72;
      eye.scale.y = blink ? 0.006 : 0.125;
      eye.rotation.z = agent.status === 'success' && pulse > 0.5 ? (index ? -0.1 : 0.1) : 0;
    });
  });

  return (
    <group
      ref={root}
      position={[def.home.x, 0, def.home.z]}
      onClick={(event) => { event.stopPropagation(); select(def.id); }}
      onPointerOver={(event) => { event.stopPropagation(); hovered.current = true; document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { hovered.current = false; document.body.style.cursor = ''; }}
    >
      <group ref={body}>
        <CharacterDetails
          def={def}
          headRef={head}
          setEye={(node, index) => { eyes.current[index] = node; }}
        />
          <mesh ref={(node) => { legs.current[0] = node; }} position={[-0.17, 0.14, 0.1]} scale={[0.16, 0.13, 0.23]} castShadow>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color={def.species === 'penguin' ? palette.yellow : palette.muzzle} />
        </mesh>
        <mesh ref={(node) => { legs.current[1] = node; }} position={[0.17, 0.14, 0.1]} scale={[0.16, 0.13, 0.23]} castShadow>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color={def.species === 'penguin' ? palette.yellow : palette.muzzle} />
        </mesh>
      </group>
      <Text position={[0, 2.35, 0]} fontSize={0.23} color="#51495b" anchorX="center" outlineWidth={0.015} outlineColor="#fffaf4">
        {def.name}
      </Text>
      <Text position={[0, 2.1, 0]} fontSize={0.11} color="#827681" anchorX="center">
        {def.role.replace('_', ' ')}
      </Text>
      {selected && <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 0.74, 40]} />
        <meshBasicMaterial color="#e89b59" transparent opacity={0.85} />
      </mesh>}
      {status === 'working' && <Text position={[0, 2.65, 0]} fontSize={0.16} color="#755fa0">✦ working ✦</Text>}
      {status === 'success' && <Text position={[0, 2.65, 0]} fontSize={0.2} color="#db9c50">✦ success</Text>}
      {status === 'error' && <Text position={[0, 2.65, 0]} fontSize={0.16} color="#b9756c">! needs help</Text>}
      {liveStatus && <Text position={[0, 2.85, 0]} fontSize={0.12} color="#397b69">● live · {liveStatus}</Text>}
      {speechText && (
        <Html position={[0, 2.9, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`speech-bubble ${speechTone}`}>{speechText}</div>
        </Html>
      )}
    </group>
  );
}

export function Characters({ liveStatuses = {} }: { liveStatuses?: Record<string, string> }) {
  return <>{agents.map((agent) => <Character key={agent.id} def={agent} liveStatus={liveStatuses[agent.id]} />)}</>;
}
