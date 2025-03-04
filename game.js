import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.132.2/examples/jsm/controls/PointerLockControls.js';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer();
    this.controls = new PointerLockControls(this.camera, document.body);
    
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.canJump = true;
    
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    
    this.prevTime = performance.now();
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.lastDelta = 1/60; // Store last good delta for pause/unpause

    this.raycaster = new THREE.Raycaster();
    this.heldCube = null;
    this.cubeHoldDistance = 3;
    
    this.cubes = [];  // Array to store all cubes for physics updates
    this.cubeVelocities = new Map();  // Map to store cube velocities
    this.cubeRotations = new Map(); // Map to store cube angular velocities
    
    this.init();
  }

  init() {
    // Create gradient sky background
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `;

    const uniforms = {
      topColor: { value: new THREE.Color(0x71c5ee) },    // Light blue
      bottomColor: { value: new THREE.Color(0xdcf5ff) }, // Very light blue
      offset: { value: 33 },
      exponent: { value: 0.6 }
    };

    const skyGeo = new THREE.SphereGeometry(500, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: uniforms,
      side: THREE.BackSide
    });

    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
    
    // Rest of initialization
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Enhanced Lighting
    const ambientLight = new THREE.AmbientLight(0x606060); 
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 3, 2);
    
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-1, 2, -1);
    
    this.scene.add(ambientLight);
    this.scene.add(directionalLight);
    this.scene.add(fillLight);

    // Floor with grid texture
    const floorGeometry = new THREE.PlaneGeometry(200, 200);
    
    // Create grid texture with dark green lines
    const gridSize = 200;
    const gridDivisions = 100;
    const gridTexture = new THREE.GridHelper(gridSize, gridDivisions, 0x0a3a0a, 0x0a3a0a); 
    gridTexture.material.opacity = 0.4;
    gridTexture.material.transparent = true;
    gridTexture.position.y = 0.01;
    this.scene.add(gridTexture);

    // Floor material with darker grass-like appearance
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x184d18, 
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 1.0
    });
    
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Replace random cube spawning with physics-enabled cubes
    for (let i = 0; i < 50; i++) {
      const cube = this.spawnCube(
        Math.random() * 160 - 80, 
        Math.random() * 20 + 1,
        Math.random() * 160 - 80  
      );
      if (cube) {
        this.cubes.push(cube);
        this.cubeVelocities.set(cube, new THREE.Vector3(0, 0, 0));
        this.cubeRotations.set(cube, new THREE.Vector3(0, 0, 0));
      }
    }

    // Camera initial position
    this.camera.position.y = 2;

    // Event listeners
    document.addEventListener('click', (event) => this.onClick(event));
    document.addEventListener('contextmenu', (event) => this.onRightClick(event));
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('resize', () => this.onWindowResize());

    // Start animation loop
    this.animate();
  }

  spawnCube(x, y, z) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ 
      color: Math.random() * 0xffffff,
      roughness: 0.7,
      metalness: 0.3
    });
    
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(x, y, z);
    cube.userData.isPickable = true;
    cube.userData.squashTimer = Math.random() * Math.PI * 2; // Random starting phase
    cube.userData.squashSpeed = 0.5 + Math.random() * 1.5; // Random animation speed
    cube.userData.squashAmount = 0.1 + Math.random() * 0.2; // Random squash intensity
    this.scene.add(cube);
    this.cubes.push(cube);
    this.cubeVelocities.set(cube, new THREE.Vector3(0, 0, 0));
    this.cubeRotations.set(cube, new THREE.Vector3(0, 0, 0));
    return cube;
  }

  updateCubePhysics(delta) {
    const gravity = -9.8;
    const damping = 0.3;
    const friction = 0.8;
    const groundFriction = 0.7;
    const rotationalDamping = 0.95;
    const angularDrag = 0.98;
    const cubeSize = 1; // Size of cube for collision detection

    for (const cube of this.cubes) {
      if (cube.userData.isHeld) continue;

      // Update squash and stretch animation
      cube.userData.squashTimer += delta * cube.userData.squashSpeed;
      const squashFactor = Math.sin(cube.userData.squashTimer) * cube.userData.squashAmount;
      cube.scale.set(
        1 - squashFactor,
        1 + squashFactor * 2,
        1 - squashFactor
      );

      const velocity = this.cubeVelocities.get(cube);
      const angularVelocity = this.cubeRotations.get(cube);
      
      // Apply gravity
      velocity.y += gravity * delta;
      
      // Update position
      cube.position.x += velocity.x * delta;
      cube.position.y += velocity.y * delta;
      cube.position.z += velocity.z * delta;

      // Update rotation
      cube.rotation.x += angularVelocity.x * delta;
      cube.rotation.y += angularVelocity.y * delta;
      cube.rotation.z += angularVelocity.z * delta;

      // Apply rotational damping
      angularVelocity.multiplyScalar(Math.pow(rotationalDamping, delta));
      
      // Floor collision with cube hitbox
      if (cube.position.y < cubeSize/2) {
        cube.position.y = cubeSize/2;
        if (velocity.y < 0) {
          velocity.y = -velocity.y * damping;
          velocity.x *= groundFriction;
          velocity.z *= groundFriction;
          
          angularVelocity.x += (Math.random() - 0.5) * velocity.length() * 0.5;
          angularVelocity.z += (Math.random() - 0.5) * velocity.length() * 0.5;
        }
      }
      
      // Cube-to-cube collision with proper cube hitbox
      for (const otherCube of this.cubes) {
        if (cube === otherCube) continue;
        
        // Check for AABB collision
        const dx = Math.abs(cube.position.x - otherCube.position.x);
        const dy = Math.abs(cube.position.y - otherCube.position.y);
        const dz = Math.abs(cube.position.z - otherCube.position.z);
        
        if (dx < cubeSize && dy < cubeSize && dz < cubeSize) {
          // Find collision normal (direction of least penetration)
          const normal = new THREE.Vector3();
          if (dx < dy && dx < dz) {
            normal.x = (cube.position.x > otherCube.position.x) ? 1 : -1;
          } else if (dy < dx && dy < dz) {
            normal.y = (cube.position.y > otherCube.position.y) ? 1 : -1;
          } else {
            normal.z = (cube.position.z > otherCube.position.z) ? 1 : -1;
          }
          
          // Push cubes apart
          const penetration = cubeSize - Math.max(dx, dy, dz);
          cube.position.add(normal.multiplyScalar(penetration * 0.5));
          
          // Calculate bounce response
          const dot = velocity.dot(normal);
          if (dot < 0) {
            velocity.sub(normal.multiplyScalar(2 * dot));
            velocity.multiplyScalar(damping);
            
            // Transfer some linear momentum to angular momentum
            angularVelocity.x += (Math.random() - 0.5) * velocity.length() * 0.3;
            angularVelocity.y += (Math.random() - 0.5) * velocity.length() * 0.3;
            angularVelocity.z += (Math.random() - 0.5) * velocity.length() * 0.3;
            
            const lateralVelocity = velocity.clone().sub(normal.multiplyScalar(velocity.dot(normal)));
            lateralVelocity.multiplyScalar(friction);
            velocity.copy(lateralVelocity.add(normal.multiplyScalar(velocity.dot(normal))));
          }
        }
      }

      // Additional velocity dampening for more stable stacking
      if (Math.abs(velocity.y) < 0.1 && cube.position.y <= cubeSize/2 + 0.01) {
        velocity.x *= 0.92;
        velocity.z *= 0.92;
        angularVelocity.multiplyScalar(angularDrag);
      }
    }
  }

  onClick(event) {
    if (!this.controls.isLocked) {
      this.controls.lock();
      return;
    }

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const spawnPosition = this.camera.position.clone().add(direction.multiplyScalar(3));
    const cube = this.spawnCube(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    if (cube) {
      const throwVelocity = direction.multiplyScalar(5);
      this.cubeVelocities.get(cube).copy(throwVelocity);
      // Add some random spin when throwing
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5
      );
      this.cubeRotations.get(cube).copy(spin);
    }
  }

  onRightClick(event) {
    event.preventDefault();
    if (!this.controls.isLocked) return;

    if (this.heldCube) {
      // Throw the held cube in looking direction
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      this.heldCube.userData.isHeld = false;
      const throwVelocity = direction.multiplyScalar(5); 
      this.cubeVelocities.get(this.heldCube).copy(throwVelocity);
      // Add some random spin when throwing
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5
      );
      this.cubeRotations.get(this.heldCube).copy(spin);
      this.heldCube = null;
    } else {
      // Try to pick up a cube
      const center = new THREE.Vector2();
      this.raycaster.setFromCamera(center, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children);
      
      for (const intersect of intersects) {
        if (intersect.object.userData.isPickable && !intersect.object.userData.isHeld) {
          this.heldCube = intersect.object;
          this.heldCube.userData.isHeld = true;
          this.cubeVelocities.get(this.heldCube).set(0, 0, 0);
          this.cubeRotations.get(this.heldCube).set(0, 0, 0);
          break;
        }
      }
    }
  }

  onKeyDown(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveForward = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveBackward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveLeft = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveRight = true;
        break;
      case 'Space':
        if (this.canJump) {
          this.velocity.y += 20;
          this.canJump = false;
        }
        break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveForward = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveBackward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveLeft = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveRight = false;
        break;
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updatePosition() {
    const pos = this.camera.position;
    document.getElementById('position').textContent = 
      `X: ${pos.x.toFixed(2)} Y: ${pos.y.toFixed(2)} Z: ${pos.z.toFixed(2)}`;
  }

  updateFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate > 1000) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      document.getElementById('fps').textContent = fps;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  updateHeldCube() {
    if (this.heldCube) {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      const targetPosition = this.camera.position.clone()
        .add(direction.multiplyScalar(this.cubeHoldDistance));
      
      this.heldCube.position.lerp(targetPosition, 0.1);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (this.controls.isLocked) {
      const time = performance.now();
      let delta = (time - this.prevTime) / 1000;
      
      // Prevent huge physics steps after unpause
      if (delta > 0.1) {
        delta = this.lastDelta;
      }
      this.lastDelta = delta;

      this.velocity.x -= this.velocity.x * 10.0 * delta;
      this.velocity.z -= this.velocity.z * 10.0 * delta;
      this.velocity.y -= 9.8 * 10.0 * delta;

      this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
      this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
      this.direction.normalize();

      if (this.moveForward || this.moveBackward) {
        this.velocity.z -= this.direction.z * 400.0 * delta;
      }
      if (this.moveLeft || this.moveRight) {
        this.velocity.x -= this.direction.x * 400.0 * delta;
      }

      this.controls.moveRight(-this.velocity.x * delta);
      this.controls.moveForward(-this.velocity.z * delta);

      this.camera.position.y += this.velocity.y * delta;

      if (this.camera.position.y < 2) {
        this.velocity.y = 0;
        this.camera.position.y = 2;
        this.canJump = true;
      }

      // Update cube physics with capped delta
      this.updateCubePhysics(Math.min(delta, 0.1));

      this.updatePosition();
      this.updateHeldCube();
      this.prevTime = time;
    } else {
      // When paused, just update the previous time without processing physics
      this.prevTime = performance.now();
    }

    this.updateFPS();
    this.renderer.render(this.scene, this.camera);
  }
}

// Start the game
new Game();