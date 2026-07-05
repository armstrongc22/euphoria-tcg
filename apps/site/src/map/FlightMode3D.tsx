/**
 * 3D Flight Mode (ux-reboot Phase D + E polish) — the real Three.js scene the
 * CSS preview reserved a seam for. Default-exported and loaded via React.lazy
 * from the Flight3D gate, so the three.js chunk is only ever downloaded by
 * visitors who open the 3D view on a capable device.
 *
 * Read-only over the SAME marker data the 2D notation map edits (the source of
 * truth): the base map is a texture on a ground plane; each visible marker is
 * a faction-colored beacon pin (pole + glowing head) placed through the shared
 * coords pipeline, honoring the schema's elevation / markerHeight /
 * view3d.{enabled,scale} authoring fields. Tapping a pin opens the SAME
 * MarkerPopup lore card as the 2D map (a DOM overlay — no in-canvas text).
 *
 * Phase E polish:
 *  - ENTRY DIVE: mounting the mode flies the camera down from high orbit to
 *    the take-off pose (~1.9s, ease-out); any pointer press skips it.
 *  - TERRITORIES: soft faction-colored glow pools under every marker that
 *    names a territory — toggleable from the HUD.
 *  - ROUTE TRAILS: "route point" markers sharing a `route:*` tag join into a
 *    glowing tube in marker order (pure convention over the existing schema;
 *    renders nothing until such markers are authored).
 *  - TERRAIN (optional): if a grayscale `maps/euphoria-heightmap.png` exists
 *    (white = high), the plane displaces and pins/pools/trails sit on the
 *    lifted ground. Absent — today — everything stays flat. No code change
 *    needed when the asset lands.
 *
 * Flight: OrbitControls with inertia (damping), clamped so the camera never
 * dives below the plane or wanders off the map. Desktop: drag to orbit, wheel
 * to dolly. Touch: one finger orbits, two fingers pinch-dolly and pan. HUD:
 * Reset flight + Territories + Back to 2D. Everything (renderer, geometries,
 * materials, textures, controls, observers, rAF) is disposed on unmount.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MapMarker } from "./markers";
import { MarkerPopup } from "./MarkerPopup";
import {
  MAX_TERRAIN_LIFT,
  WORLD_WIDTH,
  clampTarget,
  distanceLimits,
  easeOutCubic,
  entryPose,
  heightAt,
  initialPose,
  lerpPose,
  pinPlacements,
  routeTrails,
  territoryPools,
  worldDepthFor,
} from "./flight-math";

const MAP_SRC = `${import.meta.env.BASE_URL}maps/euphoria-base-map.png`;
/** Optional terrain heightmap (see module doc); missing file = flat plane. */
const HEIGHT_SRC = `${import.meta.env.BASE_URL}maps/euphoria-heightmap.png`;

const ENTRY_DIVE_MS = 1900;

interface HeightField {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Best-effort heightmap fetch: resolves null on any failure (flat terrain). */
function loadHeightField(): Promise<HeightField | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx === null) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ pixels: data.data, width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = HEIGHT_SRC;
  });
}

/** Small radial-gradient texture for the territory pools (drawn once). */
function poolTexture(): THREE.Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.55, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

interface FlightMode3DProps {
  /** The same marker set the 2D notation system edits — read-only here. */
  readonly markers: readonly MapMarker[];
  readonly onBack: () => void;
}

export default function FlightMode3D({ markers, onBack }: FlightMode3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const territoryGroupRef = useRef<THREE.Group | null>(null);
  const [popup, setPopup] = useState<MapMarker | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [territories, setTerritories] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // HUD toggle → scene visibility (no scene rebuild).
  useEffect(() => {
    if (territoryGroupRef.current !== null) {
      territoryGroupRef.current.visible = territories;
    }
  }, [territories]);

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;
    let disposed = false;
    let raf = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c10);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(4, 8, 2);
    scene.add(sun);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.08; // never below the deck

    let worldDepth = WORLD_WIDTH;
    const disposables: Array<{ dispose(): void }> = [renderer, controls];
    const pinHeads: THREE.Mesh[] = [];
    const pinByObject = new Map<THREE.Object3D, MapMarker>();
    const bobPhase = new Map<THREE.Object3D, number>();
    // The entry dive; null once the player has the stick.
    let intro: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; startedAt: number } | null = null;

    const loader = new THREE.TextureLoader();
    const loadTexture = (): Promise<THREE.Texture> =>
      new Promise((resolve, reject) => {
        loader.load(MAP_SRC, resolve, undefined, reject);
      });

    void (async () => {
      let texture: THREE.Texture;
      let heights: HeightField | null;
      try {
        [texture, heights] = await Promise.all([loadTexture(), loadHeightField()]);
      } catch {
        if (!disposed) setStatus("error");
        return;
      }
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      disposables.push(texture);
      const img = texture.image as { width: number; height: number };
      worldDepth = worldDepthFor(img.width, img.height);

      // Ground height at normalized image coords (flat without a heightmap).
      const groundAt = (u: number, v: number): number =>
        heights === null
          ? 0
          : heightAt(heights.pixels, heights.width, heights.height, u, v, MAX_TERRAIN_LIFT);

      // ---- terrain plane (displaced only when a heightmap exists) ---------
      const segments = heights === null ? 1 : 128;
      const planeGeo = new THREE.PlaneGeometry(WORLD_WIDTH, worldDepth, segments, segments);
      if (heights !== null) {
        const pos = planeGeo.attributes["position"] as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i += 1) {
          // Plane local (x, y) → image (u, v): local +y is the far edge (-z).
          const u = pos.getX(i) / WORLD_WIDTH + 0.5;
          const v = -pos.getY(i) / worldDepth + 0.5;
          pos.setZ(i, groundAt(u, v));
        }
        planeGeo.computeVertexNormals();
      }
      const planeMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
      disposables.push(planeGeo, planeMat);
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.rotation.x = -Math.PI / 2;
      scene.add(plane);

      // ---- marker beacons ---------------------------------------------------
      const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
      const headGeo = new THREE.SphereGeometry(0.05, 20, 16);
      disposables.push(poleGeo, headGeo);
      for (const pin of pinPlacements(markers, img.width, img.height)) {
        const color = new THREE.Color(pin.color);
        const group = new THREE.Group();
        const ground = groundAt(pin.x / WORLD_WIDTH + 0.5, pin.z / worldDepth + 0.5);
        group.position.set(pin.x, pin.baseY + ground, pin.z);
        group.scale.setScalar(pin.scale);

        const poleMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
        });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.scale.y = pin.height;
        pole.position.y = pin.height / 2;
        const headMat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.3,
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = pin.height;
        head.userData["baseY"] = pin.height;
        disposables.push(poleMat, headMat);

        group.add(pole, head);
        scene.add(group);
        pinHeads.push(head);
        pinByObject.set(head, pin.marker);
        pinByObject.set(pole, pin.marker);
        bobPhase.set(head, Math.random() * Math.PI * 2);
      }

      // ---- territory glow pools (HUD-toggleable) ----------------------------
      const pools = territoryPools(markers, img.width, img.height);
      if (pools.length > 0) {
        const glow = poolTexture();
        if (glow !== null) {
          disposables.push(glow);
          const poolGeo = new THREE.PlaneGeometry(1, 1);
          disposables.push(poolGeo);
          const group = new THREE.Group();
          for (const pool of pools) {
            const mat = new THREE.MeshBasicMaterial({
              map: glow,
              color: new THREE.Color(pool.color),
              transparent: true,
              opacity: 0.3,
              depthWrite: false,
            });
            disposables.push(mat);
            const mesh = new THREE.Mesh(poolGeo, mat);
            mesh.rotation.x = -Math.PI / 2;
            const ground = groundAt(pool.x / WORLD_WIDTH + 0.5, pool.z / worldDepth + 0.5);
            mesh.position.set(pool.x, ground + 0.015, pool.z);
            mesh.scale.setScalar(pool.radius * 2);
            group.add(mesh);
          }
          group.visible = territoryGroupRef.current?.visible ?? true;
          territoryGroupRef.current = group;
          scene.add(group);
        }
      }

      // ---- route trails (authored via route-point markers; none yet) --------
      for (const trail of routeTrails(markers, img.width, img.height)) {
        const points = trail.points.map(
          (p) =>
            new THREE.Vector3(
              p.x,
              groundAt(p.x / WORLD_WIDTH + 0.5, p.z / worldDepth + 0.5) + 0.05,
              p.z,
            ),
        );
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, points.length * 8, 0.018, 6, false);
        const tubeMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(trail.color),
          transparent: true,
          opacity: 0.8,
        });
        disposables.push(tubeGeo, tubeMat);
        scene.add(new THREE.Mesh(tubeGeo, tubeMat));
      }

      // ---- take-off pose, bounds, and the entry dive ------------------------
      const pose = initialPose(worldDepth);
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      controls.target.set(pose.target.x, pose.target.y, pose.target.z);
      const limits = distanceLimits(worldDepth);
      controls.minDistance = limits.min;
      controls.maxDistance = limits.max;
      controls.update();
      controls.saveState(); // Reset flight returns HERE (the final pose)
      // Now rewind to high orbit and dive in; the stick unlocks on arrival.
      const from = entryPose(worldDepth);
      camera.position.set(from.x, from.y, from.z);
      controls.enabled = false;
      intro = { from, to: pose.position, startedAt: performance.now() };
      setStatus("ready");
    })();

    resetRef.current = () => controls.reset();

    const endIntro = (): void => {
      if (intro === null) return;
      camera.position.set(intro.to.x, intro.to.y, intro.to.z);
      intro = null;
      controls.enabled = true;
      controls.update();
    };

    // Keep the orbit target over the map (soft flight bounds).
    controls.addEventListener("change", () => {
      const t = controls.target;
      const c = clampTarget(t.x, t.y, t.z, WORLD_WIDTH, worldDepth);
      t.set(c.x, c.y, c.z);
    });

    // ---- picking: tap/click a pin → lore card; hover → hint + cursor -------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (event: PointerEvent): MapMarker | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...pinByObject.keys()], false)[0];
      return hit === undefined ? null : (pinByObject.get(hit.object) ?? null);
    };

    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent): void => {
      endIntro(); // any press skips the entry dive
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (downAt === null) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 7) return;
      const marker = pick(e);
      if (marker !== null) setPopup(marker);
    };
    let hoverQueued = false;
    const onPointerMove = (e: PointerEvent): void => {
      if (hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        if (disposed) return;
        const marker = e.pointerType === "mouse" ? pick(e) : null;
        renderer.domElement.style.cursor = marker !== null ? "pointer" : "";
        setHovered(marker?.name ?? null);
      });
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // ---- sizing ------------------------------------------------------------
    const resize = (): void => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // ---- flight loop ---------------------------------------------------------
    const clock = new THREE.Clock();
    const tick = (): void => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      for (const head of pinHeads) {
        const base = head.userData["baseY"] as number;
        head.position.y = base + Math.sin(t * 1.6 + (bobPhase.get(head) ?? 0)) * 0.035;
      }
      if (intro !== null) {
        const progress = easeOutCubic((performance.now() - intro.startedAt) / ENTRY_DIVE_MS);
        const at = lerpPose(intro.from, intro.to, progress);
        camera.position.set(at.x, at.y, at.z);
        camera.lookAt(0, 0, 0);
        if (progress >= 1) endIntro();
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      territoryGroupRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      for (const d of disposables) d.dispose();
      renderer.domElement.remove();
    };
  }, [markers]);

  return (
    <div className="eu-map-3d eu-map-flight">
      <div className="eu-map-3d__bar">
        <p className="eu-map-3d__title">
          3D Flight <span className="eu-map-3d__tag">beta</span>
        </p>
        <div className="eu-map-flight__actions">
          <button
            type="button"
            className={`eu-map-btn${territories ? " eu-map-btn--on" : ""}`}
            aria-pressed={territories}
            onClick={() => setTerritories((on) => !on)}
          >
            Territories
          </button>
          <button
            type="button"
            className="eu-map-btn"
            onClick={() => resetRef.current()}
          >
            Reset flight
          </button>
          <button type="button" className="eu-map-btn" onClick={onBack}>
            ← Back to 2D Map
          </button>
        </div>
      </div>

      <div className="eu-map-flight__stage" ref={mountRef}>
        {status === "loading" && (
          <p className="eu-map-flight__status">Preparing flight…</p>
        )}
        {status === "error" && (
          <p className="eu-map-flight__status">
            The map texture failed to load — try the 2D view.
          </p>
        )}
      </div>

      <p className="eu-map-flight__hint" aria-live="polite">
        {hovered ?? "Drag to fly · scroll or pinch to dive · tap a beacon for its lore"}
      </p>

      {popup !== null && (
        <MarkerPopup marker={popup} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}
