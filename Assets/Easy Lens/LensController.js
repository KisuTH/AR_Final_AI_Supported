// Main Controller
//
// Made with Easy Lens

//@input Component.ScriptComponent sfx
//@input Component.ScriptComponent spriteStore
//@input Component.ScriptComponent touchEvents
//@input Component.ScriptComponent scoreText
//@input Component.ScriptComponent progressBar
//@input Component.ScriptComponent spriteManager
//@input Component.ScriptComponent subwayBackground
//@input Component.ScriptComponent stateText


try {

// Tunable parameters
var laneCount = 3;
var lanePaddingRatio = 0.12; // horizontal screen padding ratio on both sides
var laneSwitchDuration = 0.1; // seconds
var playerBaseSizeRatio = 0.18; // fraction of screen width
var playerYRatio = 0.72; // baseline Y in screen height (0 top, 1 bottom)
var jumpHeightRatio = 0.16; // jump peak as fraction of screen height
var jumpDuration = 0.6; // seconds total
var slideDuration = 0.6; // seconds
var runSpeedRatio = 0.75; // screen heights per second for obstacle travel
var obstacleSpawnMin = 0.7; // seconds
var obstacleSpawnMax = 1.2; // seconds
var maxObstacles = 8;
var levelDistanceMeters = 150; // abstract distance units
var metersPerScreen = 35; // how many meters per full screen height traversed
var bgTint = new vec3(1.0, 1.0, 1.0);
var playerTint = new vec3(1.0, 1.0, 1.0);
var obstacleTint = new vec3(1.0, 0.9, 0.9);
var finishTint = new vec3(1.0, 1.0, 1.0);
var showDebugHitboxes = false; // no-op visual, kept as flag
var enableSfxWin = true;

// Swipe detection params
var swipeMinDist = 0.1; // in unit space (0-1)
var swipeMaxTime = 0.35; // seconds

// Internal state
var screenSize = null;
var lanesX = [];
var currentLane = 1;
var targetLane = 1;

var player = null;
var bgSprite = null;
var finishLine = null;

var obstacles = [];
var obstaclePool = [];

var laneSwitchT = 0;
var laneSwitchFromX = 0;
var laneSwitchToX = 0;
var isLaneSwitching = false;

var isJumping = false;
var jumpTime = 0;

var isSliding = false;
var slideTime = 0;

var distanceTraveled = 0; // in meters
var gameState = "IDLE"; // IDLE, RUNNING, GAME_OVER, WIN
var spawnTimer = 0;
var nextSpawnDelay = 1.0;

var updateEvt = null;

// Input tracking
var touchStartPos = null; // vec2 in unit coords
var touchStartTime = 0;

// Cached textures
var texBg = null;
var texPlayer = null;
var texCone = null;
var texBarrier = null;
var texFinish = null;

// Utility clamp
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Initialization on start
script.createEvent("OnStartEvent").bind(function() {
    screenSize = script.spriteManager.getScreenSize();

    // Fetch textures
    texBg = script.spriteStore.getTexture("subway_bg");
    texPlayer = script.spriteStore.getTexture("player_run");
    texCone = script.spriteStore.getTexture("obstacle_cone");
    texBarrier = script.spriteStore.getTexture("obstacle_barrier");
    texFinish = script.spriteStore.getTexture("finish_line");

    // Setup static background sprite
    bgSprite = script.spriteManager.createSprite("BG");
    bgSprite.texture = texBg;
    bgSprite.stretchMode = StretchMode.Fill;
    bgSprite.size = screenSize;
    bgSprite.position = new vec2(screenSize.x * 0.5, screenSize.y * 0.5);
    bgSprite.tint = bgTint;
    bgSprite.zIndex = -10;

    // Setup player
    createPlayer();

    // Setup finish line initially off-screen (will be positioned per progress)
    finishLine = script.spriteManager.createSprite("FinishLine");
    finishLine.texture = texFinish;
    finishLine.stretchMode = StretchMode.Fit;
    var finishW = screenSize.x * 0.6;
    var finishH = finishW * 0.25;
    finishLine.size = new vec2(finishW, finishH);
    finishLine.position = new vec2(screenSize.x * 0.5, -finishH); // start above screen
    finishLine.tint = finishTint;
    finishLine.zIndex = 5;

    // UI text setup at runtime (content only)
    script.stateText.enabled = true;
    script.stateText.text = "Swipe to move\nSwipe up jump / down slide\nTap to start";
    script.stateText.forceSafeRegion(true);

    script.scoreText.enabled = true;
    script.scoreText.text = "Score: 0";
    script.scoreText.forceSafeRegion(true);

    // Progress bar start
    script.progressBar.setProgress(0);

    // Input
    setupInput();

    // Update loop
    updateEvt = script.createEvent("UpdateEvent");
    updateEvt.bind(update);
});

// Create player and lanes
function createPlayer() {
    // Lanes X in pixels
    var left = screenSize.x * lanePaddingRatio;
    var right = screenSize.x * (1.0 - lanePaddingRatio);
    var laneSpan = right - left;
    lanesX.length = 0;
    for (var i = 0; i < laneCount; i++) {
        var t = i / (laneCount - 1);
        lanesX.push(left + laneSpan * t);
    }

    // Player sprite
    player = script.spriteManager.createSprite("Player");
    player.texture = texPlayer;
    player.stretchMode = StretchMode.Fit;
    var playerW = screenSize.x * playerBaseSizeRatio;
    var playerH = playerW * 1.1;
    player.size = new vec2(playerW, playerH);
    currentLane = 1;
    targetLane = 1;
    var px = lanesX[currentLane];
    var py = screenSize.y * playerYRatio;
    player.position = new vec2(px, py);
    player.tint = playerTint;
    player.zIndex = 1;

    // Reset movement states
    isLaneSwitching = false;
    laneSwitchT = 0;
    isJumping = false;
    jumpTime = 0;
    isSliding = false;
    slideTime = 0;
}

// Input handlers
function setupInput() {
    // Prevent default Snapchat gestures for game
    script.touchEvents.blockDefaultTouches = true;
    script.touchEvents.allowDoubleTap = false;

    script.touchEvents.onTap.add(function(x, y) {
        if (gameState === "IDLE") {
            startGame();
        } else if (gameState === "GAME_OVER" || gameState === "WIN") {
            startGame();
        }
    });

    script.touchEvents.onTouchDown.add(function(id, x, y) {
        touchStartPos = new vec2(x, y);
        touchStartTime = (new Date()).getTime() * 0.001;
    });

    script.touchEvents.onTouchUp.add(function(id, x, y) {
        if (!touchStartPos) {
            return;
        }
        var endPos = new vec2(x, y);
        var dt = (new Date()).getTime() * 0.001 - touchStartTime;
        var delta = endPos.sub(touchStartPos);
        var dist = Math.sqrt(delta.x * delta.x + delta.y * delta.y);

        if (dt <= swipeMaxTime && dist >= swipeMinDist) {
            var absX = Math.abs(delta.x);
            var absY = Math.abs(delta.y);
            if (absX > absY) {
                if (delta.x < 0) {
                    onSwipeLeft();
                } else {
                    onSwipeRight();
                }
            } else {
                if (delta.y < 0) {
                    onSwipeUp();
                } else {
                    onSwipeDown();
                }
            }
        }

        touchStartPos = null;
    });
}

function onSwipeLeft() {
    if (gameState !== "RUNNING" && gameState !== "IDLE") return;
    var newLane = clamp(targetLane - 1, 0, laneCount - 1);
    if (newLane !== targetLane) {
        beginLaneSwitch(newLane);
    }
}

function onSwipeRight() {
    if (gameState !== "RUNNING" && gameState !== "IDLE") return;
    var newLane = clamp(targetLane + 1, 0, laneCount - 1);
    if (newLane !== targetLane) {
        beginLaneSwitch(newLane);
    }
}

function onSwipeUp() {
    if (gameState !== "RUNNING") return;
    if (isSliding) return; // ignore if sliding
    if (!isJumping) {
        isJumping = true;
        jumpTime = 0;
    }
}

function onSwipeDown() {
    if (gameState !== "RUNNING") return;
    if (isJumping) return; // ignore if jumping
    if (!isSliding) {
        isSliding = true;
        slideTime = 0;
    }
}

function beginLaneSwitch(newLane) {
    targetLane = newLane;
    isLaneSwitching = true;
    laneSwitchT = 0;
    laneSwitchFromX = player.position.x;
    laneSwitchToX = lanesX[targetLane];
}

// Game flow
function startGame() {
    // Clear obstacles
    for (var i = 0; i < obstacles.length; i++) {
        obstacles[i].visible = false;
        obstaclePool.push(obstacles[i]);
    }
    obstacles.length = 0;

    // Reset player and finish
    createPlayer();

    // Reset metrics
    distanceTraveled = 0;
    script.progressBar.setProgress(0);
    script.scoreText.text = "Score: 0";

    nextSpawnDelay = Math.max(obstacleSpawnMin, Math.min(obstacleSpawnMax, obstacleSpawnMin + Math.random() * (obstacleSpawnMax - obstacleSpawnMin)));
    spawnTimer = 0;

    // UI
    script.stateText.enabled = false;

    // BG
    bgSprite.tint = bgTint;

    gameState = "RUNNING";
}

// Update loop
function update() {
    var dt = getDeltaTime();
    if (gameState === "RUNNING") {
        // Distance traveled (convert obstacle screen travel to meters)
        var pixelsPerSec = screenSize.y * runSpeedRatio;
        var metersPerPixel = metersPerScreen / screenSize.y;
        distanceTraveled += pixelsPerSec * dt * metersPerPixel;

        // Update UI
        var progress = clamp(distanceTraveled / levelDistanceMeters, 0, 1);
        script.progressBar.setProgress(progress);
        script.scoreText.text = "Score: " + Math.floor(distanceTraveled);

        // Move obstacles toward player
        updateObstacles(dt, pixelsPerSec);

        // Lane switch tween
        if (isLaneSwitching) {
            laneSwitchT += dt / laneSwitchDuration;
            var t = clamp(laneSwitchT, 0, 1);
            var nx = MathUtils.lerp(laneSwitchFromX, laneSwitchToX, t);
            player.position = new vec2(nx, player.position.y);
            if (t >= 1) {
                isLaneSwitching = false;
                currentLane = targetLane;
            }
        }

        // Jump arc and slide state
        updateJumpAndSlide(dt);

        // Spawn logic
        spawnTimer += dt;
        if (spawnTimer >= nextSpawnDelay && obstacles.length < maxObstacles) {
            spawnTimer = 0;
            nextSpawnDelay = obstacleSpawnMin + Math.random() * (obstacleSpawnMax - obstacleSpawnMin);
            spawnObstacle();
        }

        // Finish line positioning and win check
        updateFinishLine(pixelsPerSec, dt);

        // Collision check
        checkCollisions();

    } else if (gameState === "IDLE") {
        // Idle hint is on, nothing to update
    } else {
        // GAME_OVER or WIN: keep finish line where it is, stop obstacle motion
    }
}

function updateJumpAndSlide(dt) {
    var basePos = player.position;
    var baseY = screenSize.y * playerYRatio;

    // Jump: simple parabola via sine: yOffset = sin(pi * t) * height
    var yOffset = 0;
    if (isJumping) {
        jumpTime += dt;
        var jt = clamp(jumpTime / jumpDuration, 0, 1);
        yOffset = Math.sin(Math.PI * jt) * (screenSize.y * jumpHeightRatio) * -1.0; // negative moves up (toward top)
        if (jt >= 1) {
            isJumping = false;
            jumpTime = 0;
            yOffset = 0;
        }
    }

    // Slide: reduce height during slide
    var size = player.size;
    if (isSliding) {
        slideTime += dt;
        var st = clamp(slideTime / slideDuration, 0, 1);
        var slideScale = 1.0 - 0.35 * Math.sin(Math.PI * Math.min(st, 1.0)); // compress mid-slide
        size = new vec2(size.x, (screenSize.x * playerBaseSizeRatio * 1.1) * slideScale);
        if (st >= 1) {
            isSliding = false;
            slideTime = 0;
        }
    } else {
        size = new vec2(size.x, (screenSize.x * playerBaseSizeRatio * 1.1));
    }

    player.size = new vec2(player.size.x, size.y);
    player.position = new vec2(player.position.x, baseY + yOffset);
}

function spawnObstacle() {
    // Random lane and type
    var lane = Math.floor(Math.random() * laneCount);
    var useCone = Math.random() < 0.5;
    var sprite = getPooledObstacle();
    sprite.texture = useCone ? texCone : texBarrier;
    sprite.stretchMode = StretchMode.Fit;

    // Size based on type
    var baseW = screenSize.x * 0.18;
    var aspect = useCone ? 0.9 : 0.6; // approximate
    var obsW = baseW;
    var obsH = obsW / aspect;
    sprite.size = new vec2(obsW, obsH);

    var x = lanesX[lane];
    var y = -obsH * 0.6; // start slightly above top
    sprite.position = new vec2(x, y);
    sprite.tint = obstacleTint;
    sprite.visible = true;
    sprite.zIndex = 2;

    // Store data: type for collision rules
    sprite.data = {
        type: useCone ? "low" : "tall", // low: can be avoided by jump; tall: must lane switch
        lane: lane
    };

    obstacles.push(sprite);
}

function getPooledObstacle() {
    if (obstaclePool.length > 0) {
        return obstaclePool.pop();
    }
    return script.spriteManager.createSprite("Obstacle");
}

function updateObstacles(dt, pixelsPerSec) {
    for (var i = obstacles.length - 1; i >= 0; i--) {
        var o = obstacles[i];
        var pos = o.position;
        pos = new vec2(pos.x, pos.y + pixelsPerSec * dt);
        o.position = pos;

        // Remove if off-screen bottom
        if (pos.y - o.size.y * 0.5 > screenSize.y * 1.1) {
            o.visible = false;
            obstaclePool.push(o);
            obstacles.splice(i, 1);
        }
    }
}

function checkCollisions() {
    for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        // Sliding reduces collision height: emulate by temporarily shrinking player's size for intersection test
        var originalSize = player.size;
        var tempPlayer = player;

        if (isSliding) {
            var shrink = 0.55;
            player.size = new vec2(originalSize.x, originalSize.y * shrink);
        }

        var intersects = script.spriteManager.isIntersecting(tempPlayer, o);

        // Restore size if changed
        if (isSliding) {
            player.size = originalSize;
        }

        if (intersects) {
            // If obstacle is low and we are in jump arc upper half, ignore
            if (o.data && o.data.type === "low" && isJumping) {
                var jt = clamp(jumpTime / jumpDuration, 0, 1);
                if (jt > 0.25 && jt < 0.75) {
                    continue; // safely jumping over
                }
            }
            // Collision
            toGameOver();
            return;
        }
    }
}

function updateFinishLine(pixelsPerSec, dt) {
    // Position finish line based on remaining distance: bring it down from above when nearing end
    var remaining = Math.max(0, levelDistanceMeters - distanceTraveled);
    var norm = 1.0 - clamp(distanceTraveled / levelDistanceMeters, 0, 1);

    // Map remaining meters to Y so that when remaining ~ metersPerScreen it approaches player Y
    var targetY;
    if (remaining > metersPerScreen) {
        // Keep off-screen above
        targetY = -finishLine.size.y;
    } else {
        // Move toward player over the last "metersPerScreen" meters
        var t = 1.0 - (remaining / metersPerScreen);
        var startY = -finishLine.size.y;
        var endY = screenSize.y * (playerYRatio - 0.25);
        targetY = MathUtils.lerp(startY, endY, clamp(t, 0, 1));
    }

    // Smooth move
    var fy = finishLine.position.y;
    var newFy = MathUtils.lerp(fy, targetY, 0.12);
    finishLine.position = new vec2(finishLine.position.x, newFy);

    // Win check by intersection or distance
    if (distanceTraveled >= levelDistanceMeters) {
        toWin();
        return;
    }
    if (script.spriteManager.isIntersecting(player, finishLine)) {
        toWin();
        return;
    }
}

function toGameOver() {
    if (gameState !== "RUNNING") return;
    gameState = "GAME_OVER";
    script.stateText.enabled = true;
    script.stateText.text = "Game Over!\nTap to restart";
    script.stateText.forceSafeRegion(true);
}

function toWin() {
    if (gameState !== "RUNNING") return;
    gameState = "WIN";
    script.stateText.enabled = true;
    script.stateText.text = "You Win!\nTap to play again";
    script.stateText.forceSafeRegion(true);
    if (enableSfxWin) {
        script.sfx.play();
    }
}

} catch(e) {
  print("error in controller");
  print(e);
}
