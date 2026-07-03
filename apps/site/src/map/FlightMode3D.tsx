/**
 * 3D Flight Mode (ux-reboot Phase D) — the real Three.js scene the CSS preview
 * reserved a seam for. Default-exported and loaded via React.lazy from the
 * Flight3D gate, so the three.js chunk is only ever downloaded by visitors who
 * open the 3D view on a capable device.
 *
 * Read-only over the SAME marker data the 2D notation map edits (the source of
 * truth): the base map is a texture on a ground plane; each visible marker is
 * a faction-colored beacon pin (pole + glowing head) placed through the shared
 * coords pipeline, honoring the schema's elevation / markerHeight /
 * view3d.{enabled,scale} authoring fields. Tapping a pin opens the SAME
 * MarkerPopup lore card as the 2D map (a DOM overlay — no in-canvas text).
 *
 * Flight: OrbitControls with inertia (damping), clamped so the camera never
 * dives below the plane or wanders off the map. Desktop: drag to orbit, wheel
 * to dolly. Touch: one finger orbits, two fingers pinch-dolly and pan. HUD:
 * Reset flight + Back to 2D. Everything (renderer, geometries, materials,
 * texture, controls, observers, rAF) is disposed on unmount.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MapMarker } from "./markers";
import { MarkerPopup } from "./MarkerPopup";
import {
  WORLD_WIDTH,
  clampTarget,
  distanceLimits,
  initialPose,
  pinPlacements,
  worldDepthFor,
} from "./flight-math";

const MAP_SRC = `${import.meta.env.BASE_URL}maps/euphoria-base-map.png`;

interface FlightMode3DProps {
  /** The same marker set the 2D notation system edits — read-only here. */
  readonly markers: readonly MapMarker[];
  readonly onBack: () => void;
}

export default function FlightMode3D({ markers, onBack }: FlightMode3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const [popup, setPopup] = useState<MapMarker | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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
    // Never below the deck; keep a whisper above the horizon.
    controls.maxPolarAngle = Math.PI / 2 - 0.08;

    // Sized once the texture (and its aspect) arrives.
    let worldDepth = WORLD_WIDTH;
    const disposables: Array<{ dispose(): void }> = [renderer, controls];
    const pinHeads: THREE.Mesh[] = [];
    const pinByObject = new Map<THREE.Object3D, MapMarker>();
    const bobPhase = new Map<THREE.Object3D, number>();

    const loader = new THREE.TextureLoader();
    loader.load(
      MAP_SRC,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        disposables.push(texture);
        const img = texture.image as { width: number; height: number };
        worldDepth = worldDepthFor(img.width, img.height);

        const planeGeo = new THREE.PlaneGeometry(WORLD_WIDTH, worldDepth);
        const planeMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
        disposables.push(planeGeo, planeMat);
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.rotation.x = -Math.PI / 2; // lay flat; image top = far edge (-Z)
        scene.add(plane);

        // ---- marker beacons (shared geometries; per-pin tinted materials) --
        const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
        const headGeo = new THREE.SphereGeometry(0.05, 20, 16);
        disposables.push(poleGeo, headGeo);
        for (const pin of pinPlacements(markers, img.width, img.height)) {
          const color = new THREE.Color(pin.color);
          const group = new THREE.Group();
          group.position.set(pin.x, pin.baseY, pin.z);
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

        // Take-off pose + camera bounds, then remember it for Reset flight.
        const pose = initialPose(worldDepth);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        controls.target.set(pose.target.x, pose.target.y, pose.target.z);
        const limits = distanceLimits(worldDepth);
        controls.minDistance = limits.min;
        controls.maxDistance = limits.max;
        controls.update();
        controls.saveState();
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("error");
      },
    );
    resetRef.current = () => controls.reset();

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
      // Generous picking: pins are small; include poles, take the nearest.
      const hit = raycaster.intersectObjects([...pinByObject.keys()], false)[0];
      return hit === undefined ? null : (pinByObject.get(hit.object) ?? null);
    };

    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent): void => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent): void => {
      // A real tap, not the tail of an orbit drag.
      if (downAt === null) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 7) return;
      const marker = pick(e);
      if (marker !== null) setPopup(marker);
    };
    let hoverQueued = false;
    const onPointerMove = (e: PointerEvent): void => {
      if (hoverQueued) return; // one raycast per frame at most
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
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
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
