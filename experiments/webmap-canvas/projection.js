import proj4 from "proj4";
import { WGS84 } from "../../src/projections.js";

const radians = Math.PI / 180;
const flattening = 1 / WGS84.inverseFlattening;
const eccentricitySquared = flattening * (2 - flattening);
const eccentricity = Math.sqrt(eccentricitySquared);

function authalic(latitude) {
  const sine = Math.sin(latitude);
  return (1 - eccentricitySquared) * (sine / (1 - eccentricitySquared * sine * sine)
    - Math.log((1 - eccentricity * sine) / (1 + eccentricity * sine)) / (2 * eccentricity));
}

export function projectionParameters(definition) {
  const latitude = definition.latitudeOfOrigin * radians;
  const result = { definition, converter: proj4("EPSG:4326", definition.wkt),
    origin: definition.centralMeridian * radians, ellipsoid: [WGS84.semiMajor, eccentricitySquared, eccentricity] };
  if (definition.kind === "albers") {
    const first = definition.standardParallel1 * radians;
    const second = definition.standardParallel2 * radians;
    const smallM = value => Math.cos(value) / Math.sqrt(1 - eccentricitySquared * Math.sin(value) ** 2);
    const cone = (smallM(first) ** 2 - smallM(second) ** 2) / (authalic(second) - authalic(first));
    const constant = smallM(first) ** 2 + cone * authalic(first);
    result.conic = [cone, constant, WGS84.semiMajor * Math.sqrt(constant - cone * authalic(latitude)) / cone];
    result.azimuthal = [0, 0, 0, 0];
    result.radius = 0;
  } else {
    const pole = authalic(Math.PI / 2);
    const beta = Math.asin(authalic(latitude) / pole);
    const radius = WGS84.semiMajor * Math.sqrt(pole / 2);
    const smallM = Math.cos(latitude) / Math.sqrt(1 - eccentricitySquared * Math.sin(latitude) ** 2);
    result.conic = [0, 0, 0];
    result.azimuthal = [pole, Math.sin(beta), Math.cos(beta), WGS84.semiMajor * smallM / (radius * Math.cos(beta))];
    result.radius = radius;
  }
  return result;
}

export const projectionGLSL = `
uniform int uProjection;
uniform float uOrigin;
uniform vec3 uEllipsoid;
uniform vec3 uConic;
uniform vec4 uAzimuthal;
uniform float uRadius;
const float PI = 3.141592653589793;
float relativeLongitude(float longitude) {
  return mod(radians(longitude) - uOrigin + PI, 2.0 * PI) - PI;
}
vec2 project(vec2 geographic) {
  float longitude = relativeLongitude(geographic.x);
  float sine = sin(radians(geographic.y));
  float eccentric = uEllipsoid.z * sine;
  float authalic = (1.0 - uEllipsoid.y) * (sine / (1.0 - uEllipsoid.y * sine * sine)
    - log((1.0 - eccentric) / (1.0 + eccentric)) / (2.0 * uEllipsoid.z));
  if (uProjection == 0) {
    float radius = uEllipsoid.x * sqrt(max(0.0, uConic.y - uConic.x * authalic)) / uConic.x;
    float angle = uConic.x * longitude;
    return vec2(radius * sin(angle), uConic.z - radius * cos(angle));
  }
  float sinBeta = clamp(authalic / uAzimuthal.x, -1.0, 1.0);
  float cosBeta = sqrt(max(0.0, 1.0 - sinBeta * sinBeta));
  float denominator = 1.0 + uAzimuthal.y * sinBeta + uAzimuthal.z * cosBeta * cos(longitude);
  float factor = uRadius * sqrt(2.0 / max(denominator, 0.0000001));
  return vec2(factor * uAzimuthal.w * cosBeta * sin(longitude),
    factor / uAzimuthal.w * (uAzimuthal.z * sinBeta - uAzimuthal.y * cosBeta * cos(longitude)));
}
`;

export function createProgram(gl, vertexSource, fragmentSource, feedback = null) {
  const shaders = [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const program = gl.createProgram();
  shaders.forEach(shader => gl.attachShader(program, shader));
  if (feedback) gl.transformFeedbackVaryings(program, feedback, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

export function setProjection(gl, program, parameters) {
  const location = name => gl.getUniformLocation(program, name);
  gl.uniform1i(location("uProjection"), parameters.definition.kind === "albers" ? 0 : 1);
  gl.uniform1f(location("uOrigin"), parameters.origin);
  gl.uniform3fv(location("uEllipsoid"), parameters.ellipsoid);
  gl.uniform3fv(location("uConic"), parameters.conic);
  gl.uniform4fv(location("uAzimuthal"), parameters.azimuthal);
  gl.uniform1f(location("uRadius"), parameters.radius);
}

export function measureGPU(gl, parameters, points) {
  const program = createProgram(gl, `#version 300 es
precision highp float;
layout(location=0) in vec2 geographic;
out vec2 projected;
${projectionGLSL}
void main() { projected = project(geographic); gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }
`, `#version 300 es
precision highp float;
out vec4 color;
void main() { color = vec4(1.0); }
`, ["projected"]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const input = gl.createBuffer();
  const output = gl.createBuffer();
  const feedback = gl.createTransformFeedback();
  gl.useProgram(program);
  setProjection(gl, program, parameters);
  gl.bindBuffer(gl.ARRAY_BUFFER, input);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points.flat()), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, points.length * 8, gl.STREAM_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, points.length);
  gl.endTransformFeedback();
  gl.disable(gl.RASTERIZER_DISCARD);
  const result = new Float32Array(points.length * 2);
  gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, result);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.bindVertexArray(null);
  gl.deleteTransformFeedback(feedback);
  gl.deleteBuffer(input);
  gl.deleteBuffer(output);
  gl.deleteVertexArray(vao);
  gl.deleteProgram(program);
  return Array.from({ length: points.length }, (_, index) => [result[index * 2], result[index * 2 + 1]]);
}
