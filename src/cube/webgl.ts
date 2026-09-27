import { getWebGLContext } from '../canvas'
import type { CutterContext } from '../context'
import type { FaceBitmaps } from '../types'
import { convertToCubeFacesCPU } from './cpu'

/**
 * 创建WebGL着色器
 *
 * @param gl - WebGL上下文
 * @param type - 着色器类型（VERTEX_SHADER 或 FRAGMENT_SHADER）
 * @param source - 着色器源代码
 */
function createShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string
): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
    }

    return shader
}

/**
 * 创建WebGL程序（链接顶点和片段着色器）
 *
 * @param gl - WebGL上下文
 * @param vertexShader - 顶点着色器
 * @param fragmentShader - 片段着色器
 */
function createProgram(
    gl: WebGLRenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader
): WebGLProgram | null {
    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program))
        return null
    }

    return program
}

// 顶点着色器：将顶点坐标转换为纹理坐标
const vertexShaderSource = `
      attribute vec2 a_position;   // 顶点位置属性
      varying vec2 v_texCoord;     // 传递给片段着色器的纹理坐标
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);  // 设置顶点位置
        v_texCoord = (a_position + 1.0) / 2.0;    // 将[-1,1]转换为[0,1]纹理坐标
      }
    `

// 片段着色器：核心转换逻辑（球面→立方体）
const fragmentShaderSource = `
      precision highp float;       // 高精度浮点运算
      uniform sampler2D u_texture; // 全景图纹理
      uniform int u_face;          // 当前处理的面索引
      varying vec2 v_texCoord;     // 插值后的纹理坐标

      // 根据面索引和归一化坐标计算射线方向向量
      vec3 getCubeDirection(int face, float nx, float ny) {
        float x = nx * 0.5;
        float y = ny * 0.5;
        if (face == 0) return vec3(-0.5, -y, -x);  // left 左面
        if (face == 1) return vec3(x, -y, -0.5);   // front 前面
        if (face == 2) return vec3(0.5, -y, x);    // right 右面
        if (face == 3) return vec3(-x, -y, 0.5);   // back 后面
        if (face == 4) return vec3(x, 0.5, y);     // up 顶面
        return vec3(x, -0.5, -y);                  // down 底面
      }

      void main() {
        // 计算当前像素在立方面上的归一化坐标 [-1, 1]
        float nx = 2.0 * v_texCoord.x - 1.0;
        float ny = 2.0 * v_texCoord.y - 1.0;
        
        // 获取射线方向向量（从立方体中心指向当前像素）
        vec3 dir = getCubeDirection(u_face, nx, ny);
        
        // 归一化为单位向量（球面坐标计算需要单位向量）
        float length = sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        vec3 normDir = dir / length;
        
        // 计算球面坐标（球坐标系）
        float theta = atan(normDir.z, normDir.x);  // 水平角度（方位角）
        float phi = asin(normDir.y);               // 垂直角度（极角）
        
        // 映射到equirectangular全景图纹理坐标 [0, 1]
        float texX = (theta + 3.14159265358979) / (2.0 * 3.14159265358979);  // 水平方向
        float texY = (3.14159265358979 / 2.0 - phi) / 3.14159265358979;        // 垂直方向
        
        // WebGL纹理坐标Y轴与canvas相反，需要翻转
        // 但上下两面不需要翻转，因为它们的视线方向本身就是上下
        if (u_face != 4 && u_face != 5) {
          texY = 1.0 - texY;
        }
        
        // 边界检查（防止越界访问）
        texX = clamp(texX, 0.0, 1.0);
        texY = clamp(texY, 0.0, 1.0);
        
        // 从全景图纹理采样颜色（GPU自动进行双线性插值）
        gl_FragColor = texture2D(u_texture, vec2(texX, texY));
      }
    `

/**
 * 使用WebGL GPU加速将球面全景图转换为六个立方体面
 *
 * 核心原理：
 * 1. 将全景图作为纹理上传到GPU
 * 2. 使用片段着色器实时计算每个像素的球面坐标
 * 3. 从全景图纹理采样对应位置的颜色
 * 4. 为六个立方体面分别渲染到canvas
 *
 * WebGL优势：GPU并行计算，速度比CPU快10-50倍
 */
export async function convertToCubeFacesWebGL(
    ctx: CutterContext,
    sourceBitmap: ImageBitmap,
    srcWidth: number,
    srcHeight: number,
    faceSize: number
): Promise<FaceBitmaps> {
    const faces = {} as FaceBitmaps

    // ==================== 初始化WebGL上下文 ====================
    const canvas = document.createElement('canvas')
    canvas.width = faceSize
    canvas.height = faceSize
    const gl = getWebGLContext(canvas)

    // 如果获取WebGL上下文失败，降级到CPU版本
    if (!gl) {
        return convertToCubeFacesCPU(
            ctx,
            sourceBitmap,
            srcWidth,
            srcHeight,
            faceSize
        )
    }

    // ==================== 创建并编译着色器 ====================
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = createShader(
        gl,
        gl.FRAGMENT_SHADER,
        fragmentShaderSource
    )
    if (!vertexShader || !fragmentShader) {
        throw new Error('WebGL 着色器编译失败')
    }

    const program = createProgram(gl, vertexShader, fragmentShader)
    if (!program) {
        throw new Error('WebGL 程序链接失败')
    }

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const textureLocation = gl.getUniformLocation(program, 'u_texture')
    const faceLocation = gl.getUniformLocation(program, 'u_face')

    // ==================== 创建顶点缓冲区 ====================
    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    // 定义两个三角形组成的矩形（覆盖整个canvas）
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
            -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
        ]),
        gl.STATIC_DRAW
    )

    // ==================== 创建并配置纹理 ====================
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // 设置纹理环绕模式（边缘拉伸）
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // 设置纹理过滤模式（双线性插值）
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // 将ImageBitmap上传到纹理
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        sourceBitmap
    )

    // 检查纹理上传是否成功（源图过大时 texImage2D 会静默失败，导致采样全黑）
    const texError = gl.getError()
    if (texError !== gl.NO_ERROR) {
        gl.deleteTexture(texture)
        gl.deleteBuffer(positionBuffer)
        gl.deleteProgram(program)
        gl.deleteShader(vertexShader)
        gl.deleteShader(fragmentShader)
        throw new Error(
            `WebGL 纹理上传失败 (error: ${texError})，源图尺寸可能超出 GPU 限制`
        )
    }

    // ==================== 设置WebGL渲染状态 ====================
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(textureLocation, 0)
    gl.viewport(0, 0, faceSize, faceSize)
    gl.clearColor(0, 0, 0, 1)

    // ==================== 渲染六个立方体面 ====================
    for (let i = 0; i < ctx.faces.length; i++) {
        const face = ctx.faces[i]!
        gl.uniform1i(faceLocation, i)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        faces[face] = await createImageBitmap(canvas)
    }

    // ==================== 清理WebGL资源 ====================
    gl.deleteTexture(texture)
    gl.deleteBuffer(positionBuffer)
    gl.deleteProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)

    return faces
}
