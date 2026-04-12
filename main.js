import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const TAU = Math.PI * 2;
const TRACK_WIDTH = 18;
const TRACK_SEGMENTS = 420;
const TRACK_MARGIN = 88;
const TARGET_CAR_LENGTH = 4.8;
const START_REFERENCE_POINT = new THREE.Vector3(126, 0, -42);
const START_REFERENCE_DIRECTION = new THREE.Vector3(-0.18, 0, 1).normalize();
const CIRCUIT_CONTROL_PROFILE = [
  [20, 40],
  [12, -28],
  [0, -118],
  [-4, -214],
  [18, -302],
  [72, -340],
  [136, -332],
  [174, -280],
  [182, -212],
  [158, -138],
  [132, -74],
  [118, 10],
  [110, 118],
  [108, 236],
  [80, 314],
  [18, 342],
  [-70, 332],
  [-152, 274],
  [-226, 216],
  [-302, 164],
  [-362, 90],
  [-382, 8],
  [-362, -76],
  [-306, -146],
  [-232, -188],
  [-156, -184],
  [-112, -126],
  [-86, -64],
  [-52, -4],
  [-12, 8],
];

const CAR_CONFIG = {
  acceleration: 27.5,
  reverseAcceleration: 10.5,
  brakeForce: 36,
  maxForwardSpeed: 58,
  maxReverseSpeed: 14,
  coastDamping: 1.8,
  roadGrip: 10.2,
  offroadGrip: 14,
  handbrakeGrip: 1.7,
  driftMinSpeed: 8,
  driftSlipBase: 7.4,
  driftSlipBoost: 0.24,
  driftYawBoost: 2.15,
  driftForwardLoss: 4.2,
  maxDriftLateral: 12.8,
  steerResponse: 9.5,
  steerRelease: 12.5,
  lowSpeedSteer: 2.6,
  highSpeedSteer: 1.12,
  offroadDrag: 4.8,
  trackAssist: 4.6,
};

const CAMERA_CONFIG = {
  distance: 6.5,
  height: 2.55,
  lookAhead: 2.15,
  lookHeight: 0.98,
};
const ROAD_DASH_LENGTH = 7.4;
const ROAD_DASH_GAP = 9.2;
const ROAD_DASH_WIDTH = 0.5;

const GAME_STATE = {
  LOADING: "loading",
  START: "start",
  PLAYING: "playing",
  PAUSED: "paused",
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
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  520,
);

const loadingOverlay = document.querySelector("[data-loading]");
const speedDisplay = document.querySelector("[data-speed]");
const lapDisplay = document.querySelector("[data-lap]");
const layoutDisplay = document.querySelector("[data-layout]");
const lapBanner = document.querySelector("[data-lap-banner]");
const lapBannerCount = document.querySelector("[data-lap-counter]");
const lapStatus = document.querySelector("[data-lap-status]");
const minimapCanvas = document.querySelector("[data-minimap]");
const minimapContext = minimapCanvas.getContext("2d");
const speedometerDial = document.querySelector("[data-speedometer-dial]");
const speedometerNeedle = document.querySelector("[data-speedometer-needle]");
const startScreen = document.querySelector("[data-start-screen]");
const pauseMenu = document.querySelector("[data-pause-menu]");
const startButton = document.querySelector("[data-start-button]");
const resumeButton = document.querySelector("[data-resume-button]");
const exitButton = document.querySelector("[data-exit-button]");
const trackTitle = document.querySelector("[data-track-title]");
const touchButtons = Array.from(document.querySelectorAll("[data-touch-control]"));
const touchButtonMap = new Map(
  touchButtons.map((button) => [button.dataset.touchControl, button]),
);
const roadTextureUrl = new URL("./assets/road-texture.svg", import.meta.url).href;
const grassTextureUrl = new URL("./assets/grass-texture.svg", import.meta.url).href;
const mustangModelUrl = new URL("./assets/mustang-gt.glb", import.meta.url).href;

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const clock = new THREE.Clock();
const cameraLookTarget = new THREE.Vector3();
const tempVector = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const dummy = new THREE.Object3D();

const track = createTrackData();
const minimapBaseCanvas = document.createElement("canvas");
minimapBaseCanvas.width = minimapCanvas.width;
minimapBaseCanvas.height = minimapCanvas.height;

const keys = new Set();
const touchDriveState = {
  accelerate: false,
  brake: false,
  left: false,
  right: false,
  handbrake: false,
};
let gameState = GAME_STATE.LOADING;
let lapNoticeTimeout = 0;
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
  isDrifting: false,
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

document.body.dataset.gameState = gameState;
layoutDisplay.textContent = track.layoutName;
trackTitle.textContent = track.layoutName;

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
    textureLoader.loadAsync(roadTextureUrl),
    textureLoader.loadAsync(grassTextureUrl),
  ]);

  configureTexture(roadTexture, 1, 1);
  configureTexture(
    grassTexture,
    Math.max(6, track.bounds.width / 26),
    Math.max(6, track.bounds.height / 26),
  );

  roadMesh.material.map = roadTexture;
  roadMesh.material.needsUpdate = true;

  groundMesh.material.map = grassTexture;
  groundMesh.material.needsUpdate = true;

  const gltf = await gltfLoader.loadAsync(mustangModelUrl);
  const model = gltf.scene;

  prepareModel(model);
  attachCarVisuals(model);
  resetSession();
  setGameState(GAME_STATE.START);

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
    color: "#5f8748",
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI * 0.5;
  groundMesh.position.set(track.bounds.centerX, -0.04, track.bounds.centerZ);
  scene.add(groundMesh);

  const shoulderMesh = createTrackStrip(
    TRACK_WIDTH * 0.5 + 7.6,
    0.008,
    new THREE.MeshStandardMaterial({
      color: "#364834",
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );

  roadMesh = createTrackStrip(
    TRACK_WIDTH * 0.5,
    0.02,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );

  scene.add(shoulderMesh, roadMesh, createRoadDashMarkers(), createStartArch());

  prepareMinimap();
}

function setupScenery() {
  const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.28, 1.7, 5);
  const leavesGeometry = new THREE.ConeGeometry(1, 2.8, 6);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: "#7c5733",
    flatShading: true,
  });
  const leavesMaterial = new THREE.MeshStandardMaterial({
    color: "#2d6b38",
    flatShading: true,
  });

  const treeCount = 48;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const leaves = new THREE.InstancedMesh(leavesGeometry, leavesMaterial, treeCount);

  for (let index = 0; index < treeCount; index += 1) {
    const sampleIndex = Math.floor((index / treeCount) * track.samples.length);
    const basePoint = track.samples[sampleIndex];
    const tangent = track.tangents[sampleIndex];
    const normal = track.normals[sampleIndex];
    const side = index % 2 === 0 ? 1 : -1;
    const lateralOffset = TRACK_WIDTH * 0.5 + 14 + pseudoRandom(index + 19) * 32;
    const tangentOffset = (pseudoRandom(index + 41) - 0.5) * 28;
    const scale = 0.82 + pseudoRandom(index + 73) * 0.7;

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
  startButton.addEventListener("click", startGame);
  resumeButton.addEventListener("click", resumeGame);
  exitButton.addEventListener("click", exitToStart);

  window.addEventListener("resize", onWindowResize);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      event.preventDefault();

      if (gameState === GAME_STATE.PLAYING) {
        pauseGame();
      } else if (gameState === GAME_STATE.PAUSED) {
        resumeGame();
      }

      return;
    }

    if (gameState === GAME_STATE.START && event.code === "Enter") {
      event.preventDefault();
      startGame();
      return;
    }

    if (gameState !== GAME_STATE.PLAYING) {
      return;
    }

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
    clearInputs();

    if (gameState === GAME_STATE.PLAYING) {
      pauseGame();
    }
  });

  touchButtons.forEach((button) => {
    const control = button.dataset.touchControl;
    const mode = button.dataset.touchMode ?? "hold";

    if (!control || !(control in touchDriveState)) {
      return;
    }

    const releaseTouchControl = (event) => {
      if (event) {
        event.preventDefault();
      }

      if (mode === "toggle") {
        return;
      }

      setTouchControlState(control, false);
    };

    button.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
      },
      { passive: false },
    );

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();

      if (gameState !== GAME_STATE.PLAYING) {
        return;
      }

      if (mode === "toggle") {
        const nextValue = !touchDriveState[control];

        if (control === "accelerate" && nextValue) {
          setTouchControlState("brake", false);
        }

        setTouchControlState(control, nextValue);
        return;
      }

      if (control === "brake") {
        setTouchControlState("accelerate", false);
      }

      setTouchControlState(control, true);
    });
    button.addEventListener("pointerup", releaseTouchControl);
    button.addEventListener("pointercancel", releaseTouchControl);
    button.addEventListener("pointerleave", releaseTouchControl);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
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

  if (gameState === GAME_STATE.PLAYING) {
    updateCar(deltaTime);
    updateLapCounter();
  }

  updateCamera();
  updateHud();

  renderer.render(scene, camera);
}

function updateCar(deltaTime) {
  updateTrackInfo(car.trackInfo, car.root.position);
  car.onRoad = car.trackInfo.distance < TRACK_WIDTH * 0.58;

  const steerTarget = getSteerInput();
  const accelerate =
    keys.has("KeyW") || keys.has("ArrowUp") || (touchDriveState.accelerate && !touchDriveState.brake);
  const brake = keys.has("KeyS") || keys.has("ArrowDown") || touchDriveState.brake;
  const handbrake = keys.has("Space") || touchDriveState.handbrake;

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
    THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 10, 0.18, 1) *
    directionSign *
    deltaTime;

  const driftActive =
    handbrake &&
    car.onRoad &&
    Math.abs(forwardSpeed) > CAR_CONFIG.driftMinSpeed &&
    Math.abs(steerTarget) > 0.02;

  if (driftActive) {
    const driftFactor = THREE.MathUtils.clamp(
      Math.abs(forwardSpeed) / CAR_CONFIG.maxForwardSpeed,
      0.45,
      1.2,
    );

    car.heading += steerTarget * CAR_CONFIG.driftYawBoost * driftFactor * deltaTime;
  }

  car.root.rotation.y = car.heading;

  const lateralGrip = !car.onRoad
    ? CAR_CONFIG.offroadGrip
    : driftActive
      ? CAR_CONFIG.handbrakeGrip
      : CAR_CONFIG.roadGrip;
  lateralSpeed = damp(lateralSpeed, 0, lateralGrip, deltaTime);

  if (driftActive) {
    lateralSpeed +=
      steerTarget *
      (CAR_CONFIG.driftSlipBase + Math.abs(forwardSpeed) * CAR_CONFIG.driftSlipBoost);
    lateralSpeed = THREE.MathUtils.clamp(
      lateralSpeed,
      -CAR_CONFIG.maxDriftLateral,
      CAR_CONFIG.maxDriftLateral,
    );
    forwardSpeed = damp(
      forwardSpeed,
      forwardSpeed * 0.82,
      CAR_CONFIG.driftForwardLoss,
      deltaTime,
    );
  } else {
    lateralSpeed += car.steer * Math.abs(forwardSpeed) * 0.15 * deltaTime;
  }

  forwardSpeed = THREE.MathUtils.clamp(
    forwardSpeed,
    -CAR_CONFIG.maxReverseSpeed,
    CAR_CONFIG.maxForwardSpeed,
  );

  car.isDrifting = driftActive && Math.abs(lateralSpeed) > 1.1;

  const nextForward = getForwardVector(car.heading, tempForward);
  const nextRight = getRightVector(car.heading, tempRight);

  car.velocity
    .copy(nextForward)
    .multiplyScalar(forwardSpeed)
    .addScaledVector(nextRight, lateralSpeed);

  if (car.onRoad) {
    const edgeFactor = THREE.MathUtils.clamp(
      (car.trackInfo.distance - TRACK_WIDTH * 0.18) / (TRACK_WIDTH * 0.4),
      0,
      1,
    );

    if (edgeFactor > 0) {
      const assistStrength = car.isDrifting
        ? CAR_CONFIG.trackAssist * 0.28
        : CAR_CONFIG.trackAssist;

      car.velocity.addScaledVector(
        car.trackInfo.toCenter,
        assistStrength * edgeFactor * deltaTime,
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
    THREE.MathUtils.clamp(-car.steer * 0.11 - lateralSpeed * 0.024, -0.16, 0.16),
    8,
    deltaTime,
  );
  car.visual.rotation.x = damp(
    car.visual.rotation.x,
    THREE.MathUtils.clamp(forwardSpeed * -0.0022, -0.05, 0.02),
    7,
    deltaTime,
  );
}

function updateCamera() {
  const forward = getForwardVector(car.heading, tempForward);

  camera.position
    .copy(car.root.position)
    .addScaledVector(forward, -CAMERA_CONFIG.distance);
  camera.position.y = CAMERA_CONFIG.height;

  cameraLookTarget
    .copy(car.root.position)
    .addScaledVector(forward, CAMERA_CONFIG.lookAhead);
  cameraLookTarget.y = CAMERA_CONFIG.lookHeight;
  camera.lookAt(cameraLookTarget);
}

function updateLapCounter() {
  const progress = car.trackInfo.progress;
  const movingForward = car.velocity.dot(car.trackInfo.tangent) > 2;

  if (progress > 0.3) {
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
    announceLapComplete();
  }

  car.previousProgress = progress;
}

function updateHud() {
  const mph = Math.round(car.velocity.length() * 2.237);
  const normalizedSpeed = THREE.MathUtils.clamp(mph / 160, 0, 1);
  const needleAngle = -120 + normalizedSpeed * 240;

  speedDisplay.textContent = String(mph);
  lapDisplay.textContent = String(car.laps);
  lapBannerCount.textContent = String(car.laps);
  speedometerDial.style.setProperty("--speed-progress", `${normalizedSpeed * 240}deg`);
  speedometerNeedle.style.transform = `translateX(-50%) rotate(${needleAngle}deg)`;

  renderMinimap();
}

function startGame() {
  if (gameState === GAME_STATE.LOADING) {
    return;
  }

  resetSession();
  setLapStatus("Lap 0 started. Cross the stripe to bank your first lap.");
  setGameState(GAME_STATE.PLAYING);
}

function pauseGame() {
  if (gameState !== GAME_STATE.PLAYING) {
    return;
  }

  clearInputs();
  setGameState(GAME_STATE.PAUSED);
}

function resumeGame() {
  if (gameState !== GAME_STATE.PAUSED) {
    return;
  }

  clearInputs();
  setGameState(GAME_STATE.PLAYING);
}

function exitToStart() {
  clearInputs();
  resetSession();
  setLapStatus("Press Start Game to begin a fresh run.");
  setGameState(GAME_STATE.START);
}

function setGameState(nextState) {
  gameState = nextState;
  document.body.dataset.gameState = nextState;

  startScreen.classList.toggle("is-hidden", nextState !== GAME_STATE.START);
  pauseMenu.classList.toggle("is-hidden", nextState !== GAME_STATE.PAUSED);

  clock.getDelta();
}

function setLapStatus(text) {
  lapStatus.textContent = text;
}

function announceLapComplete() {
  const lapLabel = car.laps === 1 ? "1 lap completed." : `${car.laps} laps completed.`;

  setLapStatus(lapLabel);
  lapBanner.classList.remove("is-popping");
  void lapBanner.offsetWidth;
  lapBanner.classList.add("is-popping");

  clearTimeout(lapNoticeTimeout);
  lapNoticeTimeout = window.setTimeout(() => {
    lapBanner.classList.remove("is-popping");
    setLapStatus("Keep pushing. Cross the stripe again to add another lap.");
  }, 1700);
}

function clearInputs() {
  keys.clear();
  Object.keys(touchDriveState).forEach((control) => {
    setTouchControlState(control, false);
  });
}

function resetSession() {
  clearTimeout(lapNoticeTimeout);
  lapBanner.classList.remove("is-popping");
  resetCar(true);
}

function resetCar(initialReset = false) {
  car.root.position.copy(track.startPoint);
  car.velocity.set(0, 0, 0);
  car.heading = Math.atan2(track.startTangent.x, track.startTangent.z);
  car.root.rotation.y = car.heading;
  car.steer = 0;
  car.isDrifting = false;
  car.visual.rotation.set(0, 0, 0);
  updateTrackInfo(car.trackInfo, car.root.position);
  car.previousProgress = car.trackInfo.progress;
  car.lapArmed = false;

  if (initialReset) {
    car.laps = 0;
  }

  updateCamera();
  updateHud();
}

function createTrackData() {
  const controlPoints = CIRCUIT_CONTROL_PROFILE.map(
    ([x, z]) => new THREE.Vector3(x, 0, z),
  );

  const curve = new THREE.CatmullRomCurve3(controlPoints, true, "centripetal");
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

  const startIndex = pickStartIndex(rawSamples, rawTangents);
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

  return {
    layoutName: "Harbor Ribbon Circuit",
    samples,
    tangents,
    normals,
    closedSamples,
    closedNormals,
    lengths,
    totalLength,
    progresses: lengths.slice(0, -1).map((length) => length / totalLength),
    bounds: getTrackBounds(samples),
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
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
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

  for (let index = 0; index < track.samples.length; index += 7) {
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

function createRoadDashMarkers() {
  const dashStep = Math.max(1, Math.round((ROAD_DASH_LENGTH + ROAD_DASH_GAP) / (track.totalLength / track.samples.length)));
  const dashIndices = [];

  for (let sampleIndex = dashStep; sampleIndex < track.samples.length - dashStep; sampleIndex += dashStep) {
    dashIndices.push(sampleIndex);
  }

  const dashes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(ROAD_DASH_WIDTH, 0.03, ROAD_DASH_LENGTH),
    new THREE.MeshStandardMaterial({
      color: "#f4efe2",
      roughness: 0.44,
      metalness: 0.02,
    }),
    dashIndices.length,
  );

  dashIndices.forEach((sampleIndex, index) => {
    const point = track.samples[sampleIndex];
    const tangent = track.tangents[sampleIndex];

    dummy.position.copy(point).setY(0.046);
    dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    dashes.setMatrixAt(index, dummy.matrix);
  });

  return dashes;
}

function createStartArch() {
  const checkerTexture = createCheckerTexture();
  checkerTexture.wrapS = THREE.RepeatWrapping;
  checkerTexture.wrapT = THREE.RepeatWrapping;
  checkerTexture.repeat.set(5.4, 1.2);
  checkerTexture.anisotropy = 4;

  const group = new THREE.Group();
  const postOffset = TRACK_WIDTH * 0.5 + 1.2;
  const postHeight = 3.4;
  const archRise = 4.1;
  const postMaterial = new THREE.MeshStandardMaterial({
    color: "#a2a9b3",
    metalness: 0.38,
    roughness: 0.42,
  });
  const archMaterial = new THREE.MeshStandardMaterial({
    map: checkerTexture,
    roughness: 0.52,
    metalness: 0.08,
  });
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: "#f4efe3",
    roughness: 0.46,
    metalness: 0,
  });
  const postGeometry = new THREE.CylinderGeometry(0.24, 0.3, postHeight, 10);

  const leftPost = new THREE.Mesh(postGeometry, postMaterial);
  leftPost.position.set(-postOffset, postHeight * 0.5, 0);

  const rightPost = new THREE.Mesh(postGeometry, postMaterial);
  rightPost.position.set(postOffset, postHeight * 0.5, 0);

  const archPoints = Array.from({ length: 16 }, (_, index) => {
    const progress = index / 15;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(-postOffset, postOffset, progress),
      postHeight + Math.sin(progress * Math.PI) * archRise,
      0,
    );
  });
  const archCurve = new THREE.CatmullRomCurve3(archPoints, false, "centripetal");
  const archMesh = new THREE.Mesh(
    new THREE.TubeGeometry(archCurve, 40, 0.35, 12, false),
    archMaterial,
  );

  const roadStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_WIDTH - 1.6, 0.95),
    stripeMaterial,
  );
  roadStripe.rotation.x = -Math.PI * 0.5;
  roadStripe.position.y = 0.05;

  group.add(leftPost, rightPost, archMesh, roadStripe);
  group.rotation.y = Math.atan2(track.startTangent.x, track.startTangent.z);
  group.position.copy(track.startPoint).setY(0.02);

  return group;
}

function createCheckerTexture() {
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
    offsetX: width * 0.5 + track.bounds.centerX * scale,
    offsetY: height * 0.5 + track.bounds.centerZ * scale,
  };

  const context = minimapBaseCanvas.getContext("2d");
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#12222c";
  context.fillRect(0, 0, width, height);

  drawTrackPath(context, TRACK_WIDTH * 1.32, "#47613b");
  drawTrackPath(context, TRACK_WIDTH * 0.9, "#3a3f45");
  drawTrackPath(context, TRACK_WIDTH * 0.08, "rgba(255, 255, 255, 0.14)");

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
    x: track.minimap.offsetX - point.x * track.minimap.scale,
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

function pickStartIndex(samples, tangents) {
  let bestIndex = 0;
  let bestScore = Infinity;

  for (let index = 0; index < tangents.length; index += 1) {
    const previous = tangents[(index - 12 + tangents.length) % tangents.length];
    const next = tangents[(index + 12) % tangents.length];
    const bendScore = 1 - THREE.MathUtils.clamp(previous.dot(next), -1, 1);
    const directionPenalty = 1 - Math.max(0, tangents[index].dot(START_REFERENCE_DIRECTION));
    const positionPenalty =
      samples[index].distanceTo(START_REFERENCE_POINT) /
      Math.max(1, TRACK_WIDTH * 3);
    const score = bendScore * 0.85 + directionPenalty * 0.45 + positionPenalty;

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

function setTouchControlState(control, nextValue) {
  if (!(control in touchDriveState)) {
    return;
  }

  touchDriveState[control] = nextValue;

  const button = touchButtonMap.get(control);

  if (button) {
    button.classList.toggle("is-active", nextValue);
    button.setAttribute("aria-pressed", String(nextValue));
  }
}

function getSteerInput() {
  const left = keys.has("KeyA") || keys.has("ArrowLeft") || touchDriveState.left;
  const right = keys.has("KeyD") || keys.has("ArrowRight") || touchDriveState.right;

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
