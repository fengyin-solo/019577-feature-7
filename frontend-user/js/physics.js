/**
 * 物理计算模块
 *
 * 统一采用薄透镜光线传递模型（ray transfer），画布渲染、焦点标注与测验
 * 判定全部使用同一套规律：
 *
 *   出射斜率 u' = u + Δu
 *   Δu = -K(y) · y / f              （凸透镜 f>0 会聚；凹透镜 f<0 发散）
 *
 *   - 水平入射（u=0）：光线交于光轴上的焦点 F
 *   - 斜入射（u≠0）：主光线（过光心 y=0）方向不变，整束光会聚到
 *     过焦点、垂直于光轴的焦平面上
 *
 * 像差（仅球面凸透镜）：
 *   - 球差（纵向）：边缘光线偏折过度，交点比近轴焦点更靠近透镜，
 *     系数 ∝ ρ⁴，ρ 为光线在透镜上的相对高度
 *   - 彗差样轴外像差：斜入射时上下边缘光线的修正不对称（∝ θ·ρ³），
 *     倾角越大越明显
 *   - 非球面透镜通过改变表面曲率补偿上述像差，K(y)=1，光线交于同一点
 *
 * 色散：
 *   - 阿贝数 Vd = (nd-1)/(nF-nC)，数值越小色散越明显
 *   - 蓝光（F线 486.1nm）折射率最大、偏折最多；红光（C线 656.3nm）最少
 *   - 画面上的分离量按教学需要做了等比放大（VISUAL_DISPERSION_SCALE）
 */
const Physics = {
    // 波长参考（nm）：红光 C线 / 绿光 d线（基准）/ 蓝光 F线
    WAVELENGTHS: {
        red: 656.3,
        green: 587.6,
        blue: 486.1
    },

    // 色散的画面放大系数（物理上 nF-nC 只有约 0.01，肉眼难辨，教学中等比放大）
    VISUAL_DISPERSION_SCALE: 6,

    // 部分色散比 (nF-nd)/(nF-nC)，冕牌玻璃约 0.7
    PARTIAL_DISPERSION_RATIO: 0.7,

    // 球面透镜边缘球差强度（对应 ρ=1 的最大纵向球差比例）
    SA_COEFFICIENT: 0.15,

    // 斜入射时的轴外像差（彗差样）强度
    COMA_COEFFICIENT: 0.4,

    /**
     * 曲率半径（教学标定常数，像素）
     * 弧度越大曲率半径越小、焦距越短
     */
    curvatureRadius(curvature, size) {
        const h = this.lensAperture(size);
        // curvature 取 10~90，得到 R 约为 (0.9~4.5)·h
        return h * (100 - curvature) / 20;
    },

    /**
     * 透镜口径（像素），与 Lens.getHeight 保持一致
     */
    lensAperture(size) {
        return 80 * (size / 100);
    },

    /**
     * 计算透镜近轴焦距（像素，凸透镜为正，凹透镜为负，平面透镜无穷大）
     * 薄透镜公式：f = R / (2(n-1))
     */
    calculateFocalLength(refractiveIndex, curvature, size) {
        return this.curvatureRadius(curvature, size) / (2 * (refractiveIndex - 1));
    },

    /**
     * 由透镜对象得到带符号近轴焦距（d线）
     */
    getFocalLength(lens) {
        if (lens.type === CONFIG.LENS_TYPES.PLANO) return Infinity;
        const f = this.calculateFocalLength(
            lens.refractiveIndex, lens.curvature, lens.getHeight()
        );
        return lens.type === CONFIG.LENS_TYPES.CONCAVE ? -f : f;
    },

    /**
     * 计算光线与透镜所在平面的交点
     * @returns {{x,y,distance}|null}
     */
    calculateRayLensIntersection(rayX, rayY, rayAngle, lens) {
        const lensX = lens.x;
        const lensY = lens.y;
        const halfHeight = lens.getHeight() / 2;

        const dirX = Math.cos(rayAngle);
        const dirY = Math.sin(rayAngle);

        if (Math.abs(dirX) < 0.001) return null;

        const dx = lensX - rayX;
        // 光线必须朝向透镜
        if ((dx > 0 && dirX < 0) || (dx < 0 && dirX > 0)) return null;
        // 距离太近跳过（防止刚穿出透镜又立即命中）
        if (Math.abs(dx) < 5) return null;

        const t = dx / dirX;
        const intersectY = rayY + t * dirY;

        if (intersectY < lensY - halfHeight || intersectY > lensY + halfHeight) return null;

        return { x: lensX, y: intersectY, distance: Math.abs(dx) };
    },

    /**
     * 像差修正系数 K(y)
     * 球面凸透镜：K = 1 + 球差项 + 斜入射彗差样项（边缘偏折过度）
     * 非球面透镜：K = 1（表面曲率补偿像差，所有光线交于同一点）
     * 凹透镜 / 平面透镜：K = 1（教学模型不额外引入边缘像差）
     *
     * @param {number} relativePos 光线在透镜上的相对高度 (-1~1)
     * @param {number} bundleAngle 入射光束相对光轴的倾角（弧度）
     * @param {object} lens 透镜
     * @returns {number} 像差系数
     */
    aberrationFactor(relativePos, bundleAngle, lens) {
        if (lens.type !== CONFIG.LENS_TYPES.CONVEX) return 1;

        const r = Math.min(1, Math.abs(relativePos));
        const r2 = r * r;
        const sign = relativePos >= 0 ? 1 : -1;

        // 纵向球差：边缘光线（r→1）多偏折 SA_COEFFICIENT，上下对称
        const sa = this.SA_COEFFICIENT * r2 * r2;

        // 斜入射轴外像差（彗差样）：∝ sinθ·|ρ|³·sign(ρ)
        // 上、下边缘光线修正相反 → 倾角越大，两个边缘交点越不对称
        const coma = this.COMA_COEFFICIENT * Math.sin(bundleAngle) * r2 * r * sign;

        return 1 + sa + coma;
    },

    /**
     * 薄透镜光线传递：计算折射后的光线角度
     *
     * @param {number} rayAngle 入射光线角度（相对水平方向，弧度）
     * @param {number} rayY 交点 Y（画布坐标）
     * @param {object} lens 透镜
     * @param {number} [bundleAngle=0] 入射光束倾角（弧度），斜入射时决定轴外像差
     * @param {string} [effectiveType] 强制透镜类型（球面/非球面对比时使用）
     * @returns {number} 折射后光线角度
     */
    calculateRefractedAngle(rayAngle, rayY, lens, bundleAngle = 0, effectiveType = null, indexOverride = null) {
        const type = effectiveType || lens.type;

        if (type === CONFIG.LENS_TYPES.PLANO) {
            // 平行平板：方向不变（垂直入射无侧移，斜入射有侧移，方向仍不变）
            return rayAngle;
        }

        const n = indexOverride !== null ? indexOverride : lens.refractiveIndex;
        const halfHeight = lens.getHeight() / 2;
        const relativePos = (rayY - lens.y) / halfHeight;

        // 带符号焦距：凸正凹负
        let f = this.calculateFocalLength(n, lens.curvature, lens.getHeight());
        if (type === CONFIG.LENS_TYPES.CONCAVE) f = -f;

        // 近轴薄透镜：Δu = -y / f（以光轴为原点的高度）
        const y = rayY - lens.y;
        let deltaU = -y / f;

        // 球面凸透镜边缘偏折过度；非球面 K=1 精准会聚
        if (type === CONFIG.LENS_TYPES.CONVEX) {
            const probeLens = effectiveType ? { ...lens, type: effectiveType } : lens;
            deltaU *= this.aberrationFactor(relativePos, bundleAngle, probeLens);
        }

        const uIn = Math.tan(Utils.clamp(rayAngle, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01));
        let uOut = uIn + deltaU;
        uOut = Utils.clamp(uOut, -50, 50);
        return Math.atan(uOut);
    },

    /**
     * 计算某波长（颜色）光的折射率
     *
     * 以阿贝数 Vd 标定色散强度：
     *   nF - nC = (nd - 1) / Vd
     *   nF - nd = ratio · (nF - nC)
     * 画面分离量再统一放大 VISUAL_DISPERSION_SCALE 倍便于观察。
     *
     * @param {number} baseIndex 基准折射率 nd（d线/绿光）
     * @param {number} dispersion 材料色散标记（0~1，仅用于无阿贝数时回退）
     * @param {string} color 'red' | 'green' | 'blue'
     * @param {number} [abbeNumber] 阿贝数 Vd
     * @returns {number}
     */
    calculateDispersionIndex(baseIndex, dispersion, color, abbeNumber = null) {
        if (color === 'green') return baseIndex;

        const V = abbeNumber !== null && abbeNumber > 0
            ? abbeNumber
            : this.dispersionToAbbe(dispersion);

        // F、C 线折射率差（画面放大后）
        const nFnC = this.VISUAL_DISPERSION_SCALE * (baseIndex - 1) / V;
        const deltaBlue = this.PARTIAL_DISPERSION_RATIO * nFnC;

        if (color === 'blue') return baseIndex + deltaBlue;
        if (color === 'red') return baseIndex - (nFnC - deltaBlue);
        return baseIndex;
    },

    /**
     * 旧色散标记到阿贝数的回退映射（兼容无 abbeNumber 的调用）
     * dispersion 0.08 → V≈80，0.4 → V≈40
     */
    dispersionToAbbe(dispersion) {
        if (dispersion <= 0) return Infinity;
        return Utils.clamp(Math.round(40 / dispersion + 30), 20, 500);
    },

    /**
     * 计算阿贝数 Vd（数值越大色散越小）
     * 优先使用材料标定值，保证与实际玻璃参数一致
     */
    calculateAbbeNumber(baseIndex, dispersion, abbeNumber = null) {
        if (abbeNumber !== null && abbeNumber > 0) return abbeNumber;
        if (dispersion <= 0) return Infinity;

        // 由画面模型反推真实阿贝数（去掉教学放大系数）
        const nF = this.calculateDispersionIndex(baseIndex, dispersion, 'blue', abbeNumber);
        const nC = this.calculateDispersionIndex(baseIndex, dispersion, 'red', abbeNumber);
        const spread = (nF - nC) / this.VISUAL_DISPERSION_SCALE;
        return spread > 0 ? (baseIndex - 1) / spread : Infinity;
    },

    /**
     * 生成平行光束（从画布左侧射入）
     *
     * 光线间距自动覆盖画布高度以及最左侧透镜的完整口径，
     * 保证斜入射时仍有足够光线穿过透镜，色散与焦点变化清晰可见。
     *
     * @param {number} canvasHeight 画布高度
     * @param {number} rayCount 光线数量
     * @param {number} angleDeg 入射倾角（度，正角向下倾斜）
     * @param {object} [cover] {x, halfHeight} 需要覆盖的最左透镜位置与半高
     * @param {number} [canvasWidth] 画布宽度
     * @returns {Array<{x,y,angle}>}
     */
    generateParallelRays(canvasHeight, rayCount, angleDeg, cover = null, canvasWidth = 0) {
        const rays = [];
        const angleRad = Utils.degToRad(angleDeg);
        const tanA = Math.tan(angleRad);

        // 光线在左边缘的起始高度
        const startYs = [];

        if (cover && canvasWidth > 0) {
            // 左边缘高度 y0 的光线到达透镜处高度为 y0 + x·tanθ，
            // 要让透镜处高度落在口径内，须 y0 = yLens - x·tanθ
            const shift = -cover.x * tanA;
            const apertureMin = cover.y - cover.halfHeight * 0.9 + shift;
            const apertureMax = cover.y + cover.halfHeight * 0.9 + shift;

            const apertureCount = Math.max(2, Math.ceil(rayCount / 2));
            for (let i = 0; i < apertureCount; i++) {
                const t = apertureCount > 1 ? i / (apertureCount - 1) : 0.5;
                startYs.push(apertureMin + t * (apertureMax - apertureMin));
            }

            // 其余光线均匀分布在画布高度上（保持整束光的视野感）
            const restCount = rayCount - apertureCount;
            for (let i = 1; i <= restCount; i++) {
                startYs.push(canvasHeight * i / (restCount + 1));
            }
        } else {
            for (let i = 1; i <= rayCount; i++) {
                startYs.push(canvasHeight * i / (rayCount + 1));
            }
        }

        startYs
            .sort((a, b) => a - b)
            .forEach(y => rays.push({ x: 0, y, angle: angleRad }));
        return rays;
    },

    /**
     * 生成点光源光线（从左侧一点发散）
     */
    generatePointSourceRays(sourceX, sourceY, rayCount, spreadAngle = 60) {
        const rays = [];
        const halfSpread = Utils.degToRad(spreadAngle / 2);
        const step = rayCount > 1 ? (2 * halfSpread) / (rayCount - 1) : 0;

        for (let i = 0; i < rayCount; i++) {
            rays.push({
                x: sourceX,
                y: sourceY,
                angle: -halfSpread + step * i
            });
        }
        return rays;
    },

    /**
     * 计算斜入射平行光当前有效的倾角范围（度）
     *
     * 判据：
     *  1. 主光线（过透镜光心）必须从画布左边缘可见区域射入；
     *  2. 覆盖透镜口径 75% 的边缘光线在左边缘仍在可见范围内。
     * 超出范围时光束无法在画布内完整照到透镜，据此给出提示并保留原值。
     *
     * @returns {{min:number, max:number}|null} 没有可用透镜时返回 null
     */
    effectiveAngleRange(lenses, canvasWidth, canvasHeight) {
        if (!lenses || lenses.length === 0) return null;

        // 以最靠左的透镜为准（光束遇到的第一个透镜）
        const lens = lenses.reduce((a, b) => (a.x <= b.x ? a : b));
        const halfH = lens.getHeight() / 2;
        const margin = 20;
        const top = margin;
        const bottom = canvasHeight - margin;

        // 主光线在左边缘的高度：y0 = cy - x·tanθ，须在 [top, bottom]
        // 边缘光线还需覆盖口径的 75%
        const m = halfH * 0.75;
        const d = lens.x;

        // 主光线与 ±75% 口径边缘光线在左边缘的高度都须在 [top, bottom]。
        // 约束：top ≤ cy + s·m - d·tanθ ≤ bottom（s ∈ {-1, 0, +1}）
        //        ⇒ (cy+s·m-bottom)/d ≤ tanθ ≤ (cy+s·m-top)/d
        // 交集：下界取最大、上界取最小
        const lowers = [];
        const uppers = [];
        [-1, 0, 1].forEach(s => {
            lowers.push((lens.y + s * m - bottom) / d);
            uppers.push((lens.y + s * m - top) / d);
        });

        let tanMin = Math.max(...lowers);
        let tanMax = Math.min(...uppers);

        // 限制到配置的物理调节范围
        const aMin = Utils.degToRad(CONFIG.INCIDENT_ANGLE.MIN);
        const aMax = Utils.degToRad(CONFIG.INCIDENT_ANGLE.MAX);
        tanMin = Math.max(tanMin, Math.tan(aMin));
        tanMax = Math.min(tanMax, Math.tan(aMax));

        const min = Utils.radToDeg(Math.atan(tanMin));
        const max = Utils.radToDeg(Math.atan(tanMax));
        if (min > max) return null;

        return {
            min: Math.ceil(min),
            max: Math.floor(max)
        };
    },

    /**
     * 追踪一条近轴光线（相对光轴高度 h、斜率 u）穿过透镜后的会聚点
     * 用于焦点/球差标注与测验判定，与画面光线追踪完全同规律
     *
     * @param {object} lens 透镜（可用色散后折射率）
     * @param {number} bundleAngleDeg 光束倾角（度）
     * @param {number} relativeHeight 光线在透镜上的相对高度 (-1~1)
     * @param {string} [effectiveType] 强制透镜类型
     * @returns {{x,y}|null} 出射光线与近轴焦面/光轴的交点
     */
    traceParaxialRay(lens, bundleAngleDeg, relativeHeight = 0, effectiveType = null, indexOverride = null) {
        const type = effectiveType || lens.type;
        if (type === CONFIG.LENS_TYPES.PLANO) return null;

        const bundleAngle = Utils.degToRad(bundleAngleDeg);
        const halfH = lens.getHeight() / 2;
        const hitY = lens.y + relativeHeight * halfH;
        const newAngle = this.calculateRefractedAngle(
            bundleAngle, hitY, lens, bundleAngle, effectiveType, indexOverride
        );

        // 出射光与近轴焦面 x = lens.x + f_eff 的交点
        const n = indexOverride !== null ? indexOverride : lens.refractiveIndex;
        let f = this.calculateFocalLength(n, lens.curvature, lens.getHeight());
        if (type === CONFIG.LENS_TYPES.CONCAVE) f = -f;

        const slope = Math.tan(newAngle);
        if (type === CONFIG.LENS_TYPES.CONVEX) {
            // 会聚光：与焦平面相交（斜入射时焦点离开光轴）
            return {
                x: lens.x + f,
                y: hitY + f * slope
            };
        }
        // 凹透镜发散：反向延长线交于入射侧虚焦面
        return {
            x: lens.x + f, // f 为负
            y: hitY + f * slope
        };
    },

    /**
     * 纵向球差比例：边缘光线焦点相对近轴焦点的前移量 / f
     * 球面凸透镜才有（非球面为 0），供测验判定与画面标注共用
     */
    longitudinalSphericalAberration(lens, effectiveType = null) {
        const type = effectiveType || lens.type;
        if (type !== CONFIG.LENS_TYPES.CONVEX) return 0;
        const factor = this.aberrationFactor(1, 0, { type });
        // K=1+SA → 边缘焦点前移比例 SA/(1+SA)
        return (factor - 1) / factor;
    },

    /**
     * 边缘光线（透镜相对高度 ρ 处）出射后与主光线的交点
     * 主光线过透镜光心、方向不偏，沿光束倾角直线传播。
     * 用于绘制球差/彗差光斑：
     *   - 水平入射：交点在光轴上，球面透镜比近轴焦点更靠近透镜（球差）
     *   - 斜入射：上、下边缘交点错开（彗差样轴外像差）
     *
     * @returns {{x,y}|null}
     */
    traceMarginalCrossing(lens, bundleAngleDeg, relativeHeight, effectiveType = null) {
        const type = effectiveType || lens.type;
        if (type === CONFIG.LENS_TYPES.PLANO) return null;
        if (type === CONFIG.LENS_TYPES.CONCAVE) return null; // 发散光无实际交点

        const bundleAngle = Utils.degToRad(bundleAngleDeg);
        const halfH = lens.getHeight() / 2;
        const yHit = lens.y + relativeHeight * halfH;

        const chiefSlope = Math.tan(bundleAngle);
        const outAngle = this.calculateRefractedAngle(
            bundleAngle, yHit, lens, bundleAngle, effectiveType
        );
        const outSlope = Math.tan(outAngle);

        // 交点：chief(x) = cy + chiefSlope·(x-lens.x)
        //       edge(x)  = yHit + outSlope·(x-lens.x)
        const denom = chiefSlope - outSlope;
        if (Math.abs(denom) < 1e-6) return null;

        const dx = (yHit - lens.y) / denom;
        return {
            x: lens.x + dx,
            y: lens.y + chiefSlope * dx
        };
    }
};
