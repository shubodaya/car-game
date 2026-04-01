import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const TAU = Math.PI * 2;
const TRACK_WIDTH = 16;
const TRACK_SEGMENTS = 360;
const TRACK_MARGIN = 72;
const TARGET_CAR_LENGTH = 4.8;

const CAR_CONFIG = {
  acceleration: 19,
  reverseAcceleration: 8,
  brakeForce: 31,
  maxForwardSpeed: 40,
  maxReverseSpeed: 12,
  coastDamping: 1.6,
  roadGrip: 11,
  offroadGrip: 19,
  handbrakeGrip: 5.2,
  driftSlipBoost: 1.85,
  maxDriftLateral: 6.4,
  steerResponse: 9,
  steerRelease: 12,
  lowSpeedSteer: 2.45,
  highSpeedSteer: 1.08,
  offroadDrag: 4.1,
  trackAssist: 5.2,
};

const CAMERA_CONFIG = {
  distance: 7.1,
  height: 3.2,
  lookAhead: 6.5,
  followSharpness: 5,
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;

document.querySelector("#app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8ec7ff");
scene.fog = new THREE.Fog("#8ec7ff", 190, 360);

const camera = new THREE.PerspectiveCamera(
  56,
  window.innerWidth / window.innerHeight,
  0.1,
  520,
);

const loadingOverlay = document.querySelector("[data-loading]");
const speedDisplay = document.querySelector("[data-speed]");
const lapDisplay = document.querySelector("[data-lap]");
const minimapCanvas = document.querySelector("[data-minimap]");
const minimapContext = minimapCanvas.getContext("2d");
const speedometerDial = document.querySelector("[data-speedometer-dial]");
const speedometerNeedle = document.querySelector("[data-speedometer-needle]");

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const clock = new THREE.Clock();
const cameraLookTarget = new THREE.Vector3();
const tempVector = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempCameraPosition = new THREE.Vector3();
const tempCameraTarget = new THREE.Vector3();
const dummy = new THREE.Object3D();

const track = createTrackData();
const minimapBaseCanvas = document.createElement("canvas");
minimapBaseCanvas.width = minimapCanvas.width;
minimapBaseCanvas.height = minimapCanvas.height;

const keys = new Set();
const car = {
  root: new THREE.Group(),
  visual: new THREE.Group(),
  model: null,
  velocity: new THREE.Vector3(),
  heading: 0,
  steer: 0,
  laps: 0,
  lapArmed: false,
  previousProgress: 0,
  onRoad: true,
  trackInfo: {
    index: 0,
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    normal: new THREE.Vector3(1, 0, 0),
    toCenter: new THREE.Vector3(),
    distance: 0,
    progress: 0,
  },
};

car.root.add(car.visual);
scene.add(car.root);

let roadMesh;
let groundMesh;

setupLights();
setupTrack();
setupScenery();
setupEvents();

loadScene().catch((error) => {
  console.error(error);
  loadingOverlay.querySelector(".loading__title").textContent =
    "Could not load the Mustang model.";
});

async function loadScene() {
  const [roadTexture, grassTexture] = await Promise.all([
    textureLoader.loadAsync("./assets/road-texture.svg"),
    textureLoader.loadAsync("./assets/grass-texture.svg"),
  ]);

  configureTexture(roadTexture, 1, 1);
  configureTexture(
    grassTexture,
    Math.max(6, track.bounds.width / 24),
    Math.max(6, track.bounds.height / 24),
  );

  roadMesh.material.map = roadTexture;
  roadMesh.material.needsUpdate = true;

  groundMesh.material.map = grassTexture;
  groundMesh.material.needsUpdate = true;

  const gltf = await gltfLoader.loadAsync("./assets/mustang-gt.glb");
  const model = gltf.scene;

  prepareModel(model);
  attachCarVisuals(model);
  resetCar(true);

  loadingOverlay.classList.add("is-hidden");
  requestAnimationFrame(animate);
}

function setupLights() {
  const ambientLight = new THREE.AmbientLight("#ffffff", 1.75);
  const sunLight = new THREE.DirectionalLight("#fff3d0", 1.38);
  sunLight.position.set(48, 64, 28);

  scene.add(ambientLight, sunLight);
}

function setupTrack() {
  const groundGeometry = new THREE.PlaneGeometry(
    track.bounds.width + TRACK_MARGIN * 2,
    track.bounds.height + TRACK_MARGIN * 2,
  );
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: "#6e9f59",
    roughness: 1,
    metalness: 0,
  });

  groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI * 0.5;
  groundMesh.position.set(track.bounds.centerX, -0.04, track.bounds.centerZ);
  scene.add(groundMesh);

  const shoulderMesh = createTrackStrip(
    TRACK_WIDTH * 0.5 + 6.8,
    0.008,
    new THREE.MeshStandardMaterial({
      color: "#698f55",
      roughness: 1,
      metalness: 0,
    }),
  );

  roadMesh = createTrackStrip(
    TRACK_WIDTH * 0.5,
    0.02,
    new THREE.MeshStandardMaterial({
      color: "#393f45",
      roughness: 1,
      metalness: 0,
    }),
  );

  scene.add(shoulderMesh, roadMesh);
  scene.add(createEdgeLine(TRACK_WIDTH * 0.5 - 0.8, "#f5ecd1"));
  scene.add(createEdgeLine(-(TRACK_WIDTH * 0.5 - 0.8), "#f5ecd1"));
  scene.add(createCenterGuideLine());
  scene.add(createStartLine());

  prepareMinimap();
}

function setupScenery() {
  const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.28, 1.7, 6);
  const leavesGeometry = new THREE.ConeGeometry(1, 2.8, 8);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: "#7c5733",
    flatShading: true,
  });
  const leavesMaterial = new THREE.MeshStandardMaterial({
    color: "#2d6b38",
    flatShading: true,
  });

  const treeCount = 56;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const leaves = new THREE.InstancedMesh(leavesGeometry, leavesMaterial, treeCount);

  for (let index = 0; index < treeCount; index += 1) {
    const sampleIndex = Math.floor((index / treeCount) * track.samples.length);
    const basePoint = track.samples[sampleIndex];
    const tangent = track.tangents[sampleIndex];
    const normal = track.normals[sampleIndex];
    const side = index % 2 === 0 ? 1 : -1;
    const lateralOffset = TRACK_WIDTH * 0.5 + 10 + pseudoRandom(index + 19) * 20;
    const tangentOffset = (pseudoRandom(index + 41) - 0.5) * 18;
    const scale = 0.86 + pseudoRandom(index + 73) * 0.58;

    dummy.position
      .copy(basePoint)
      .addScaledVector(normal, side * lateralOffset)
      .addScaledVector(tangent, tangentOffset);
    dummy.position.y = 0.85 * scale;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);

    dummy.position.y = 2.6 * scale;
    dummy.updateMatrix();
    leaves.setMatrixAt(index, dummy.matrix);
  }

  scene.add(trunks, leaves);
}

function setupEvents() {
  window.addEventListener("resize", onWindowResize);

  window.addEventListener("keydown", (event) => {
    if (
      event.code === "Space" ||
      event.code.startsWith("Arrow") ||
      event.code === "KeyW" ||
      event.code === "KeyA" ||
      event.code === "KeyS" ||
      event.code === "KeyD"
    ) {
      event.preventDefault();
    }

    if (event.code === "KeyR") {
      resetCar();
      return;
    }

    keys.add(event.code);
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
  });
}

function prepareModel(model) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      materials.forEach((material) => {
        if (material?.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
        }
      });
    }
  });

  const forward = detectModelForward(model);
  const yawOffset = Math.atan2(forward.x, forward.z);

  model.rotation.y -= yawOffset;
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = TARGET_CAR_LENGTH / Math.max(size.x, size.z);

  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());

  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= scaledBox.min.y;
  model.updateMatrixWorld(true);
}

function attachCarVisuals(model) {
  car.model = model;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.95, 28),
    new THREE.MeshBasicMaterial({
      color: "#000000",
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );

  shadow.rotation.x = -Math.PI * 0.5;
  shadow.position.y = 0.03;
  shadow.scale.set(1.3, 1.7, 1);

  car.visual.add(shadow, model);
}

function detectModelForward(root) {
  root.updateMatrixWorld(true);

  const front = averageMarkerPosition(root, [
    /FRONTBUMPER/i,
    /HEADLIGHT/i,
    /GLASS_FRONT/i,
  ]);
  const rear = averageMarkerPosition(root, [
    /REARBUMPER/i,
    /TAILLIGHT/i,
    /GLASS_REAR/i,
  ]);

  if (front && rear) {
    const forward = front.sub(rear).setY(0);

    if (forward.lengthSq() > 0.0001) {
      return forward.normalize();
    }
  }

  return new THREE.Vector3(0, 0, 1);
}

function averageMarkerPosition(root, patterns) {
  const matches = [];

  root.traverse((child) => {
    if (patterns.some((pattern) => pattern.test(child.name))) {
      matches.push(child);
    }
  });

  if (!matches.length) {
    return null;
  }

  const average = new THREE.Vector3();

  for (const child of matches) {
    child.getWorldPosition(tempVector);
    average.add(root.worldToLocal(tempVector.clone()));
  }

  return average.multiplyScalar(1 / matches.length);
}

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.05);

  updateCar(deltaTime);
  updateLapCounter();
  updateCamera(deltaTime);
  updateHud();

  renderer.render(scene, camera);
}

function updateCar(deltaTime) {
  updateTrackInfo(car.trackInfo, car.root.position);
  car.onRoad = car.trackInfo.distance < TRACK_WIDTH * 0.58;

  const steerTarget = getSteerInput();
  const accelerate = keys.has("KeyW") || keys.has("ArrowUp");
  const brake = keys.has("KeyS") || keys.has("ArrowDown");
  const handbrake = keys.has("Space");

  car.steer = damp(
    car.steer,
    steerTarget,
    Math.abs(steerTarget) > 0 ? CAR_CONFIG.steerResponse : CAR_CONFIG.steerRelease,
    deltaTime,
  );

  const currentForward = getForwardVector(car.heading, tempForward);
  const currentRight = getRightVector(car.heading, tempRight);

  let forwardSpeed = car.velocity.dot(currentForward);
  let lateralSpeed = car.velocity.dot(currentRight);

  if (accelerate !== brake) {
    if (accelerate) {
      const push = forwardSpeed < -1 ? CAR_CONFIG.brakeForce : CAR_CONFIG.acceleration;
      forwardSpeed += push * deltaTime;
    } else if (brake) {
      const push = forwardSpeed > 1
        ? CAR_CONFIG.brakeForce
        : CAR_CONFIG.reverseAcceleration;
      forwardSpeed -= push * deltaTime;
    }
  } else {
    forwardSpeed = damp(forwardSpeed, 0, CAR_CONFIG.coastDamping, deltaTime);
  }

  if (!car.onRoad) {
    forwardSpeed = damp(forwardSpeed, 0, CAR_CONFIG.offroadDrag, deltaTime);
  }

  const speedRatio = THREE.MathUtils.clamp(
    Math.abs(forwardSpeed) / CAR_CONFIG.maxForwardSpeed,
    0,
    1,
  );
  const steerStrength = THREE.MathUtils.lerp(
    CAR_CONFIG.lowSpeedSteer,
    CAR_CONFIG.highSpeedSteer,
    speedRatio,
  );
  const directionSign = forwardSpeed === 0 ? 1 : Math.sign(forwardSpeed);

  car.heading +=
    car.steer *
    steerStrength *
    THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 12, 0.16, 1) *
    directionSign *
    deltaTime;
  car.root.rotation.y = car.heading;

  const lateralGrip = !car.onRoad
    ? CAR_CONFIG.offroadGrip
    : handbrake
      ? CAR_CONFIG.handbrakeGrip
      : CAR_CONFIG.roadGrip;

  // The car is still arcade-driven: forward speed and sideways slip are split
  // in car space so grip can be tuned directly without a full wheel model.
  lateralSpeed = damp(lateralSpeed, 0, lateralGrip, deltaTime);

  // Handbrake drift keeps some slip, but it is clamped and paired with track
  // recovery so pressing Space does not launch the car off the road.
  if (handbrake && car.onRoad && Math.abs(forwardSpeed) > 9 && Math.abs(car.steer) > 0.04) {
    lateralSpeed += car.steer * Math.abs(forwardSpeed) * CAR_CONFIG.driftSlipBoost * deltaTime;
    lateralSpeed = THREE.MathUtils.clamp(
      lateralSpeed,
      -CAR_CONFIG.maxDriftLateral,
      CAR_CONFIG.maxDriftLateral,
    );
    forwardSpeed = damp(forwardSpeed, forwardSpeed * 0.9, 6.5, deltaTime);
  } else {
    lateralSpeed += car.steer * Math.abs(forwardSpeed) * 0.2 * deltaTime;
  }

  forwardSpeed = THREE.MathUtils.clamp(
    forwardSpeed,
    -CAR_CONFIG.maxReverseSpeed,
    CAR_CONFIG.maxForwardSpeed,
  );

  const nextForward = getForwardVector(car.heading, tempForward);
  const nextRight = getRightVector(car.heading, tempRight);

  car.velocity
    .copy(nextForward)
    .multiplyScalar(forwardSpeed)
    .addScaledVector(nextRight, lateralSpeed);

  if (car.onRoad) {
    const edgeFactor = THREE.MathUtils.clamp(
      (car.trackInfo.distance - TRACK_WIDTH * 0.18) / (TRACK_WIDTH * 0.38),
      0,
      1,
    );

    if (edgeFactor > 0) {
      car.velocity.addScaledVector(
        car.trackInfo.toCenter,
        CAR_CONFIG.trackAssist * (handbrake ? 1.05 : 1) * edgeFactor * deltaTime,
      );
    }
  }

  const totalSpeed = car.velocity.length();
  if (totalSpeed > CAR_CONFIG.maxForwardSpeed * 1.04) {
    car.velocity.setLength(CAR_CONFIG.maxForwardSpeed * 1.04);
  }

  car.root.position.addScaledVector(car.velocity, deltaTime);
  car.root.position.y = 0;

  updateTrackInfo(car.trackInfo, car.root.position);
  car.onRoad = car.trackInfo.distance < TRACK_WIDTH * 0.58;

  car.visual.rotation.z = damp(
    car.visual.rotation.z,
    THREE.MathUtils.clamp(-car.steer * 0.08 - lateralSpeed * 0.018, -0.11, 0.11),
    8,
    deltaTime,
  );
  car.visual.rotation.x = damp(
    car.visual.rotation.x,
    THREE.MathUtils.clamp(forwardSpeed * -0.002, -0.045, 0.02),
    7,
    deltaTime,
  );
}

function updateCamera(deltaTime) {
  const forward = getForwardVector(car.heading, tempForward);

  const desiredPosition = tempCameraPosition
    .copy(car.root.position)
    .addScaledVector(forward, -CAMERA_CONFIG.distance)
    .setY(CAMERA_CONFIG.height);

  const desiredLookTarget = tempCameraTarget
    .copy(car.root.position)
    .addScaledVector(forward, CAMERA_CONFIG.lookAhead)
    .setY(1.3);

  // Keep one stable chase framing at all speeds so the car reads the same
  // whether stationary, accelerating, or drifting through a corner.
  const cameraBlend = 1 - Math.exp(-CAMERA_CONFIG.followSharpness * deltaTime);
  camera.position.lerp(desiredPosition, cameraBlend);
  cameraLookTarget.lerp(desiredLookTarget, cameraBlend);
  camera.lookAt(cameraLookTarget);
}

function updateLapCounter() {
  const progress = car.trackInfo.progress;
  const movingForward = car.velocity.dot(car.trackInfo.tangent) > 2;

  if (progress > 0.35) {
    car.lapArmed = true;
  }

  if (
    car.lapArmed &&
    car.previousProgress > 0.92 &&
    progress < 0.08 &&
    movingForward
  ) {
    car.laps += 1;
    car.lapArmed = false;
  }

  car.previousProgress = progress;
}

function updateHud() {
  const mph = Math.round(car.velocity.length() * 2.237);
  const normalizedSpeed = THREE.MathUtils.clamp(mph / 160, 0, 1);
  const needleAngle = -120 + normalizedSpeed * 240;

  speedDisplay.textContent = String(mph);
  lapDisplay.textContent = String(car.laps);
  speedometerDial.style.setProperty("--speed-progress", `${normalizedSpeed * 240}deg`);
  speedometerNeedle.style.transform = `translateX(-50%) rotate(${needleAngle}deg)`;

  renderMinimap();
}

function resetCar(initialReset = false) {
  car.root.position.copy(track.startPoint);
  car.velocity.set(0, 0, 0);
  car.heading = Math.atan2(track.startTangent.x, track.startTangent.z);
  car.root.rotation.y = car.heading;
  car.steer = 0;
  car.visual.rotation.set(0, 0, 0);
  updateTrackInfo(car.trackInfo, car.root.position);
  car.previousProgress = car.trackInfo.progress;
  car.lapArmed = false;

  if (initialReset) {
    car.laps = 0;
  }

  updateCamera(1 / 60);
  updateHud();
}

function createTrackData() {
  const controlPoints = [];
  const controlCount = 16;

  for (let index = 0; index < controlCount; index += 1) {
    const angle = (index / controlCount) * TAU;
    const radial = 112 + (pseudoRandom(index + 17) - 0.5) * 44;
    const xStretch = 1.28 + (pseudoRandom(index + 41) - 0.5) * 0.16;
    const zStretch = 0.96 + (pseudoRandom(index + 73) - 0.5) * 0.22;
    const waveX = Math.sin(angle * 2.5 + 0.4) * 18;
    const waveZ = Math.cos(angle * 3.2 - 0.6) * 14;

    controlPoints.push(
      new THREE.Vector3(
        Math.cos(angle) * radial * xStretch + waveX,
        0,
        Math.sin(angle) * radial * zStretch + waveZ,
      ),
    );
  }

  const curve = new THREE.CatmullRomCurve3(controlPoints, true, "catmullrom", 0.42);
  const rawSamples = [];
  const rawTangents = [];
  const rawNormals = [];

  for (let index = 0; index < TRACK_SEGMENTS; index += 1) {
    const progress = index / TRACK_SEGMENTS;
    const point = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).setY(0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    point.y = 0;
    rawSamples.push(point);
    rawTangents.push(tangent);
    rawNormals.push(normal);
  }

  const startIndex = pickStartIndex(rawTangents);
  const samples = rotateLoop(rawSamples, startIndex);
  const tangents = rotateLoop(rawTangents, startIndex);
  const normals = rotateLoop(rawNormals, startIndex);
  const closedSamples = [...samples, samples[0].clone()];
  const closedNormals = [...normals, normals[0].clone()];

  const lengths = [0];
  let totalLength = 0;

  for (let index = 1; index < closedSamples.length; index += 1) {
    totalLength += closedSamples[index].distanceTo(closedSamples[index - 1]);
    lengths.push(totalLength);
  }

  const bounds = getTrackBounds(samples);

  return {
    samples,
    tangents,
    normals,
    closedSamples,
    closedNormals,
    lengths,
    totalLength,
    progresses: lengths.slice(0, -1).map((length) => length / totalLength),
    bounds,
    startPoint: samples[0].clone(),
    startTangent: tangents[0].clone(),
    startNormal: normals[0].clone(),
    minimap: null,
  };
}

function createTrackStrip(halfWidth, y, material) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let index = 0; index < track.closedSamples.length; index += 1) {
    const point = track.closedSamples[index];
    const normal = track.closedNormals[index];
    const left = tempVector.copy(point).addScaledVector(normal, halfWidth);
    const right = tempVectorB.copy(point).addScaledVector(normal, -halfWidth);
    const repeatV = track.lengths[index] / 6.8;

    positions.push(left.x, y, left.z, right.x, y, right.z);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, repeatV, 1, repeatV);
  }

  for (let index = 0; index < track.closedSamples.length - 1; index += 1) {
    const base = index * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return new THREE.Mesh(geometry, material);
}

function createEdgeLine(offset, color) {
  const points = track.samples.map((point, index) =>
    point.clone().addScaledVector(track.normals[index], offset),
  );

  points.push(points[0].clone());

  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color }),
  );
}

function createCenterGuideLine() {
  const points = [];

  for (let index = 0; index < track.samples.length; index += 8) {
    const point = track.samples[index];
    points.push(point.clone().setY(0.055));
  }

  points.push(points[0].clone());

  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.16,
    }),
  );
}

function createStartLine() {
  const texture = createStartLineTexture();
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_WIDTH - 1.3, 3.6),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );

  startLine.rotation.x = -Math.PI * 0.5;
  startLine.rotation.y = Math.atan2(track.startTangent.x, track.startTangent.z);
  startLine.position.copy(track.startPoint).setY(0.06);
  return startLine;
}

function createStartLineTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const cellWidth = canvas.width / 10;
  const cellHeight = canvas.height / 2;

  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      context.fillStyle = (row + column) % 2 === 0 ? "#101114" : "#ffffff";
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function prepareMinimap() {
  const padding = 18;
  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  const scale = Math.min(
    (width - padding * 2) / track.bounds.width,
    (height - padding * 2) / track.bounds.height,
  );

  track.minimap = {
    scale,
    offsetX: width * 0.5 - track.bounds.centerX * scale,
    offsetY: height * 0.5 + track.bounds.centerZ * scale,
  };

  const context = minimapBaseCanvas.getContext("2d");
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#12222c";
  context.fillRect(0, 0, width, height);

  drawTrackPath(context, TRACK_WIDTH * 1.3, "#5f7d4f");
  drawTrackPath(context, TRACK_WIDTH * 0.82, "#374047");
  drawTrackPath(context, TRACK_WIDTH * 0.08, "rgba(255, 255, 255, 0.16)");

  const startLeft = track.startPoint
    .clone()
    .addScaledVector(track.startNormal, TRACK_WIDTH * 0.4);
  const startRight = track.startPoint
    .clone()
    .addScaledVector(track.startNormal, -TRACK_WIDTH * 0.4);
  const startLeftMap = worldToMinimap(startLeft);
  const startRightMap = worldToMinimap(startRight);

  context.strokeStyle = "#f8f8f8";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(startLeftMap.x, startLeftMap.y);
  context.lineTo(startRightMap.x, startRightMap.y);
  context.stroke();
}

function drawTrackPath(context, worldWidth, color) {
  const scaleWidth = Math.max(2, worldWidth * track.minimap.scale);

  context.strokeStyle = color;
  context.lineWidth = scaleWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  track.samples.forEach((point, index) => {
    const mapPoint = worldToMinimap(point);

    if (index === 0) {
      context.moveTo(mapPoint.x, mapPoint.y);
    } else {
      context.lineTo(mapPoint.x, mapPoint.y);
    }
  });

  const firstPoint = worldToMinimap(track.samples[0]);
  context.lineTo(firstPoint.x, firstPoint.y);
  context.stroke();
}

function renderMinimap() {
  minimapContext.drawImage(minimapBaseCanvas, 0, 0);

  const carPoint = worldToMinimap(car.root.position);
  const forward = getForwardVector(car.heading, tempForward);
  const headingPoint = worldToMinimap(
    tempVector.copy(car.root.position).addScaledVector(forward, 10),
  );

  minimapContext.strokeStyle = "#ffd166";
  minimapContext.lineWidth = 2.5;
  minimapContext.beginPath();
  minimapContext.moveTo(carPoint.x, carPoint.y);
  minimapContext.lineTo(headingPoint.x, headingPoint.y);
  minimapContext.stroke();

  minimapContext.fillStyle = "#ffd166";
  minimapContext.beginPath();
  minimapContext.arc(carPoint.x, carPoint.y, 4.6, 0, TAU);
  minimapContext.fill();
}

function worldToMinimap(point) {
  return {
    x: point.x * track.minimap.scale + track.minimap.offsetX,
    y: track.minimap.offsetY - point.z * track.minimap.scale,
  };
}

function updateTrackInfo(target, position) {
  let bestIndex = 0;
  let bestDistanceSq = Infinity;

  for (let index = 0; index < track.samples.length; index += 1) {
    const point = track.samples[index];
    const dx = position.x - point.x;
    const dz = position.z - point.z;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  }

  target.index = bestIndex;
  target.point.copy(track.samples[bestIndex]);
  target.tangent.copy(track.tangents[bestIndex]);
  target.normal.copy(track.normals[bestIndex]);
  target.progress = track.progresses[bestIndex];
  target.distance = Math.sqrt(bestDistanceSq);
  target.toCenter
    .set(target.point.x - position.x, 0, target.point.z - position.z);

  if (target.toCenter.lengthSq() > 0.0001) {
    target.toCenter.normalize();
  } else {
    target.toCenter.copy(target.normal);
  }
}

function pickStartIndex(tangents) {
  let bestIndex = 0;
  let bestScore = Infinity;

  for (let index = 0; index < tangents.length; index += 1) {
    const previous = tangents[(index - 10 + tangents.length) % tangents.length];
    const next = tangents[(index + 10) % tangents.length];
    const bendScore = 1 - THREE.MathUtils.clamp(previous.dot(next), -1, 1);
    const forwardPenalty = tangents[index].z < 0.15 ? 0.12 : 0;
    const score = bendScore + forwardPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function rotateLoop(values, startIndex) {
  return [...values.slice(startIndex), ...values.slice(0, startIndex)];
}

function getTrackBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  });

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
    width: maxX - minX,
    height: maxZ - minZ,
  };
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function configureTexture(texture, repeatX, repeatY) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
}

function getSteerInput() {
  const left = keys.has("KeyA") || keys.has("ArrowLeft");
  const right = keys.has("KeyD") || keys.has("ArrowRight");

  if (left === right) {
    return 0;
  }

  return left ? 1 : -1;
}

function getForwardVector(heading, target) {
  return target.set(Math.sin(heading), 0, Math.cos(heading));
}

function getRightVector(heading, target) {
  return target.set(Math.cos(heading), 0, -Math.sin(heading));
}

function damp(value, target, lambda, deltaTime) {
  return THREE.MathUtils.lerp(value, target, 1 - Math.exp(-lambda * deltaTime));
}

function pseudoRandom(seed) {
  const raw = Math.sin(seed * 91.357) * 43758.5453123;
  return raw - Math.floor(raw);
}
