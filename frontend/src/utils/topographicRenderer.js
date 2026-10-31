const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uElevation;
uniform sampler2D uWater;
uniform vec2 uViewport;
uniform vec2 uGrid;
uniform float uCellSize;
uniform float uPixelRatio;
uniform float uTime;
out vec4 fragmentColor;

float elevationAt(vec2 pixel) {
  vec2 position = clamp(pixel / uCellSize, vec2(0.0), uGrid - 1.001);
  ivec2 origin = ivec2(floor(position));
  vec2 fraction = fract(position);
  float upper = mix(texelFetch(uElevation, origin, 0).r,
    texelFetch(uElevation, origin + ivec2(1, 0), 0).r, fraction.x);
  float lower = mix(texelFetch(uElevation, origin + ivec2(0, 1), 0).r,
    texelFetch(uElevation, origin + ivec2(1, 1), 0).r, fraction.x);
  return mix(upper, lower, fraction.y);
}

float waterAt(vec2 pixel) {
  ivec2 origin = ivec2(floor(clamp(pixel / uCellSize, vec2(0.0), uGrid - 1.001)));
  return max(max(texelFetch(uWater, origin, 0).r, texelFetch(uWater, origin + ivec2(1, 0), 0).r),
    max(texelFetch(uWater, origin + ivec2(0, 1), 0).r, texelFetch(uWater, origin + ivec2(1, 1), 0).r));
}

float contourInk(float elevation, float interval, float slope, float width) {
  float distance = abs(mod(elevation + interval * 0.5, interval) - interval * 0.5);
  return 1.0 - smoothstep(width * uPixelRatio, width * uPixelRatio + 0.85, distance / slope);
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uViewport.y * uPixelRatio - gl_FragCoord.y) / uPixelRatio;
  vec2 relative = pixel / uViewport;
  float elevation = elevationAt(pixel);
  float slope = max(fwidth(elevation), 0.002);
  float dy = (relative.y - 0.46) / (relative.y < 0.46 ? 0.20 : 0.28);
  float dx = (relative.x - 0.5) / 0.285;
  float quiet = exp(-1.6 * (pow(dx, 4.0) + pow(dy, 4.0)));
  vec2 gradient = vec2(dFdx(elevation), -dFdy(elevation)) * uPixelRatio / 4.5;
  float light = dot(normalize(vec3(gradient, 1.0)), vec3(0.55, 0.55, 0.63));
  float altitude = clamp((elevation - 195.0) / 320.0, 0.0, 1.0);
  vec3 paper = vec3(249.0, 251.0, 248.0) / 255.0;
  vec3 land = mix(vec3(241.0, 246.0, 237.0), vec3(218.0, 228.0, 216.0), altitude) / 255.0;
  land += (light - 0.63) * 0.153;
  land = mix(land, paper, quiet * 0.76);
  float minor = contourInk(elevation, 20.0, slope, 0.25);
  float major = contourInk(elevation, 100.0, slope, 0.48);
  land = mix(land, vec3(0.31, 0.41, 0.35), minor * 0.20 * (1.0 - quiet * 0.45));
  land = mix(land, vec3(0.25, 0.34, 0.29), major * 0.39 * (1.0 - quiet * 0.45));

  float waterLevel = waterAt(pixel);
  float waterCoverage = step(1.0, waterLevel) * (1.0 - smoothstep(-slope * 0.5, slope * 0.5, elevation - waterLevel));
  float depth = pow(clamp((waterLevel - elevation) / 85.0, 0.0, 1.0), 0.65);
  vec3 water = mix(vec3(208.0, 231.0, 227.0), vec3(130.0, 187.0, 193.0), depth) / 255.0;
  float ripple = sin(pixel.y * 0.36 + sin(pixel.x * 0.034 + uTime * 0.3) * 0.7 + uTime * 0.32);
  float glint = smoothstep(0.975, 1.0, ripple) * (0.5 + 0.5 * sin(pixel.x * 0.09 + pixel.y * 0.04));
  water += glint * 0.045 * smoothstep(0.0, 0.25, depth);
  vec3 color = mix(land, water, waterCoverage);
  float shoreDistance = abs(elevation - waterLevel) / slope;
  float shore = step(1.0, waterLevel) * (1.0 - smoothstep(0.32 * uPixelRatio, 0.32 * uPixelRatio + 0.9, shoreDistance));
  color = mix(color, vec3(0.28, 0.49, 0.5), shore * 0.45);
  float grain = fract(sin(dot(floor(pixel), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  fragmentColor = vec4(color + grain / 510.0, 1.0);
}`;

export function createTopographicRenderer(canvas) {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!context) return null;
  const shaders = [];
  const textures = [];
  let program;
  let available = true;
  let columns = 0;
  let rows = 0;
  const loseContext = event => { event.preventDefault(); available = false; };
  const dispose = () => {
    canvas.removeEventListener('webglcontextlost', loseContext);
    shaders.forEach(shader => context.deleteShader(shader));
    textures.forEach(texture => context.deleteTexture(texture));
    if (program) context.deleteProgram(program);
  };

  try {
    for (const [type, source] of [[context.VERTEX_SHADER, VERTEX_SHADER], [context.FRAGMENT_SHADER, FRAGMENT_SHADER]]) {
      const shader = context.createShader(type);
      shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader));
    }
    program = context.createProgram();
    shaders.forEach(shader => context.attachShader(program, shader));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error(context.getProgramInfoLog(program));
    context.useProgram(program);
    for (let index = 0; index < 2; index++) {
      const texture = context.createTexture();
      textures.push(texture);
      context.activeTexture(context.TEXTURE0 + index);
      context.bindTexture(context.TEXTURE_2D, texture);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    }
    const uniforms = Object.fromEntries(['uElevation', 'uWater', 'uViewport', 'uGrid', 'uCellSize', 'uPixelRatio', 'uTime']
      .map(name => [name, context.getUniformLocation(program, name)]));
    context.uniform1i(uniforms.uElevation, 0);
    context.uniform1i(uniforms.uWater, 1);
    canvas.addEventListener('webglcontextlost', loseContext);

    return {
      draw(grid, water, width, height, pixelRatio, time) {
        if (!available || context.isContextLost()) return false;
        context.viewport(0, 0, canvas.width, canvas.height);
        context.useProgram(program);
        const resized = columns !== grid.columns || rows !== grid.rows;
        columns = grid.columns;
        rows = grid.rows;
        for (const [index, values] of [grid.values, water].entries()) {
          context.activeTexture(context.TEXTURE0 + index);
          context.bindTexture(context.TEXTURE_2D, textures[index]);
          if (resized) context.texImage2D(context.TEXTURE_2D, 0, context.R32F, columns, rows, 0, context.RED, context.FLOAT, values);
          else context.texSubImage2D(context.TEXTURE_2D, 0, 0, 0, columns, rows, context.RED, context.FLOAT, values);
        }
        context.uniform2f(uniforms.uViewport, width, height);
        context.uniform2f(uniforms.uGrid, columns, rows);
        context.uniform1f(uniforms.uCellSize, grid.cellSize);
        context.uniform1f(uniforms.uPixelRatio, pixelRatio);
        context.uniform1f(uniforms.uTime, time);
        context.drawArrays(context.TRIANGLES, 0, 3);
        return true;
      },
      dispose,
    };
  } catch (error) {
    console.warn('Topographic background is using Canvas rendering:', error.message);
    dispose();
    return null;
  }
}