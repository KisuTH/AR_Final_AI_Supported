//@input Asset.Texture inTexture {"hint":"set device texture here or other texture you want to draw over"}
//@input Component.MeshVisual sparklesMesh
//@input bool advancedSetup
//@input Asset.Material matAvgCol {"showIf":"advancedSetup"}
//@input Asset.Material matNormalize {"showIf":"advancedSetup"}
//@input Asset.Material matDetector {"showIf":"advancedSetup"}
//@input Asset.Material matReduce {"showIf":"advancedSetup"}
//@input Asset.Material matDrawReduce {"showIf":"advancedSetup"}
//@input Asset.Material matBC_Accum {"showIf":"advancedSetup"}
//@input bool drawDebug
//@input int texDebug {"showIf":"drawDebug", "widget":"combobox", "values":[{"label":"avgcolor", "value":"0"}, {"label":"detector", "value":"1"}, {"label":"reduce", "value":"3"}, {"label":"accum", "value":"4"}]}
//@input Component.PostEffectVisual postDebug {"showIf":"drawDebug"}

script.sparklesMesh.enabled = true;
var renderLayerAvgCol = LayerSet.makeUnique()
var renderLayerDetector = LayerSet.makeUnique()
var renderLayerReduceMask = LayerSet.makeUnique()
var renderLayerBC = LayerSet.makeUnique()

var cameraRenderOrder = -10
function createCameraToRenderLayer(layerId) {
    var camera = script.getSceneObject().createComponent('Camera');
    camera.renderOrder = cameraRenderOrder
    cameraRenderOrder += 1
    camera.renderLayer = layerId
    return camera;
}

function createRenderTexture(size, clearColor) {
    var texture = scene.createRenderTargetTexture();
    texture.control.useScreenResolution = false;
    texture.control.resolution = size
    texture.control.msaa = false
    texture.control.fxaa = false
    texture.control.clearColor = clearColor
    texture.control.clearColorOption = ClearColorOption.CustomTexture;
    return texture
}

function createRenderTextureCam(size, clearColor, renderLayer) {
    var texture = createRenderTexture(size, clearColor)
    var cam = createCameraToRenderLayer(renderLayer)
    cam.renderTarget = texture
    return texture
}

var renderOrder = 20;
function createComponentForPass(compType, layerId, material) {
    var sceneObj = scene.createSceneObject("")
    sceneObj.layer = layerId;
    renderOrder += 1
    var comp = sceneObj.createComponent(compType)
    comp.mainMaterial = material
    comp.setRenderOrder(renderOrder);
    return comp;
}

function createPostForPass(layerId, material) {
    return createComponentForPass("PostEffectVisual", layerId, material);
}

///////////////////////////////////////////////////////////////////////////////
// *** Camera for MinMax color pass ***
var minmaxTexture = createRenderTextureCam(new vec2(2, 2), new vec4(0.5, 0.1, 0.9, 1.0), renderLayerAvgCol)

var minmaxPost = createPostForPass(renderLayerAvgCol, script.matAvgCol)
minmaxPost.mainPass.mainTexture = script.inTexture;

// *** BC_Accum camera ***
var bc_accumTexture = createRenderTextureCam(new vec2(9, 16), new vec4(0.5, 0.0, 1.0, 1.0), renderLayerBC)

var drawReducePost = createPostForPass(renderLayerBC, script.matDrawReduce)
var bc_accumPost = createPostForPass(renderLayerBC, script.matBC_Accum)

// *** detector camera ***
var detectorTexture = createRenderTextureCam(new vec2(360, 640), new vec4(0.0, 0.0, 0.0, 1.0), renderLayerDetector)

var normalizePost = createPostForPass(renderLayerDetector, script.matNormalize)
normalizePost.mainPass.mainTexture = script.inTexture;
normalizePost.mainPass.minmaxTex = minmaxTexture;

var detectorPost = createPostForPass(renderLayerDetector, script.matDetector)
detectorPost.mainPass.accumTex = bc_accumTexture;


var reduceTexture = createRenderTextureCam(new vec2(45, 80), new vec4(0.0, 0.0, 0.0, 1.0), renderLayerReduceMask)

var reducePost = createPostForPass(renderLayerReduceMask, script.matReduce)
reducePost.mainPass.mainTexture = detectorTexture;

drawReducePost.mainPass.reduceTex = reduceTexture;

for (var i = 0; i<script.sparklesMesh.getMaterialsCount(); i+=1) {
    script.sparklesMesh.getMaterial(i).mainPass.texMask = reduceTexture;
}

// *** Camera for Sparkles & debug pass ***
if (script.postDebug) {
    script.postDebug.enabled = script.drawDebug
    if (script.drawDebug) {
        if (script.texDebug==0)
            script.postDebug.mainPass.mainTexture = minmaxTexture;
        if (script.texDebug==1)
            script.postDebug.mainPass.mainTexture = detectorTexture;
        if (script.texDebug==3)
            script.postDebug.mainPass.mainTexture = reduceTexture;
        if (script.texDebug==4)
            script.postDebug.mainMaterial.mainPass.mainTexture = bc_accumTexture;
    }
}

var framenum = 0.0;

function upd(eventData) {
    if (framenum < 1.5) {
        if (framenum > 0.5) {
            minmaxTexture.control.clearColorOption = ClearColorOption.None;
            detectorTexture.control.clearColorOption = ClearColorOption.None;
            bc_accumTexture.control.clearColorOption = ClearColorOption.None;
        }
        framenum += 1.0
    }
    script.matAvgCol.mainPass.myRun = 2.2;
}

var updEvent = script.createEvent("SceneEvent.UpdateEvent")
updEvent.bind(upd)
