/**
 * 物理计算模块
 *
 * 统一光学规律（薄透镜模型，全部透镜共用）：
 * - 近轴偏折：tan(θ′) = tan(θ) − K·h，其中 K = (n−1)·c·0.8
 *   凸透镜 K>0 会聚、凹透镜 K<0 发散、平面透镜 K=0 不偏折
 * - 球面透镜：边缘光线额外多偏折，球差增量与 h² 成正比
 *   tan(θ′) = tan(θ) − K·h·(1 + SA·h²)
 * - 非球面透镜：按每条光线的高度精确分配偏折角
 *   tan(θ′) = tan(θ) + (tan(θ) − h/f)，使任意倾角的平行光
 *   都精确会聚到后焦面上的同一点，球差为0
 *
 * 斜入射规律：
 * - 倾角 θ 的平行光，出射后会聚到后焦面上 (f, f·tanθ) 处
 * - 不同波长 n(λ) 不同，蓝光 n 最大→f 最短、偏折最多；红光反之
 * - 于是三色光的焦点在轴向和横向同时分开，斜入射时横向色散一目了然
 *
 * 色散与阿贝数：
 * - nF−nC = (nd−1)/Vd（Vd 为阿贝数），阿贝数越小色散越强
 * - 高折射率片 Vd≈25 < 普通玻璃 Vd≈45 < ED低色散片 Vd≈90
 * - 教学演示用 DISPERSION_GAIN 统一放大色散开度，物理相对规律不变
 */
const Physics = {
    // 三色光波长（nm）：C 红光、d 绿光（基准）、F 蓝光
    WAVELENGTHS: {
        red: 656.3,
        green: 587.6,
        blue: 486.1
    },

    /**
     * 近轴光焦度 K = (n−1)·(curvature/100)·0.8
     * 凸/凹/平/非球面共用同一基准；凹透镜的曲率参数自带负号处理在调用处
     */
    calculatePower(refractiveIndex, curvature) {
        return (refractiveIndex - 1) * (curvature / 100) * CONFIG.PHYSICS.DEFLECT_FACTOR;
    },

    /**
     * 近轴焦距 f = 半高 / K（与 analyzeLens 的追迹结果一致）
     */
    calculateFocalLength(refractiveIndex, curvature, height) {
        const K = this.calculatePower(refractiveIndex, curvature);
        if (Math.abs(K) < 1e-6) return Infinity;
        return (height / 2) / K;
    },

    /**
     * 计算某颜色光的折射率
     *
     * n(λ) 以 d 线 nd 为基准，按阿贝数定义分配：
     *   nF − nC = (nd − 1) / Vd
     *   nF − nd ≈ 0.3008·(nF − nC)，nd − nC ≈ 0.6992·(nF − nC)
     * 再乘以教学演示增益，使画布上的色散分离便于观察。
     *
     * @param {number} baseIndex d 线折射率
     * @param {number} abbeNumber 阿贝数 Vd
     * @param {string} color 'red' | 'green' | 'blue'
     */
    calculateDispersionIndex(baseIndex, abbeNumber, color) {
        if (color === 'green' || !abbeNumber || !isFinite(abbeNumber)) {
            return baseIndex;
        }
        const spread = (baseIndex - 1) / abbeNumber * CONFIG.PHYSICS.DISPERSION_GAIN;
        if (color === 'blue') return baseIndex + 0.3008 * spread;
        return baseIndex - 0.6992 * spread; // red
    },

    /**
     * 核心：计算薄透镜折射后的光线角度（弧度）
     *
     * @param {number} rayAngle 入射角（光轴为0）
     * @param {number} rayY 交点高度（画布坐标）
     * @param {object} lens 透镜（type/curvature/refractiveIndex/y）
     * @param {string} [color] 光线颜色，缺省用 d 线折射率
     */
    calculateRefractedAngle(rayAngle, rayY, lens, color = null) {
        const halfHeight = lens.getHeight() / 2;
        const h = (rayY - lens.y) / halfHeight; // 归一化高度 -1 ~ 1
        // 指定颜色时按阿贝数取该波长折射率；否则直接用透镜（可能已是某颜色的）折射率
        const n = color
            ? this.calculateDispersionIndex(lens.refractiveIndex, lens.abbeNumber, color)
            : lens.refractiveIndex;
        const type = lens.type;

        // 平面透镜：方向不变（仅侧移）
        if (type === CONFIG.LENS_TYPES.PLANO) {
            return rayAngle;
        }

        const convex = type !== CONFIG.LENS_TYPES.CONCAVE;
        const K = this.calculatePower(n, lens.curvature) * (convex ? 1 : -1);
        const tanIn = Math.tan(rayAngle);

        if (type === CONFIG.LENS_TYPES.ASPHERIC) {
            // 非球面：每条光线精确偏折，使出射光全部指向后焦面上的同一点
            // （tan空间近轴线性，无边缘附加项 → 正入射零球差、斜入射零彗差）
            const tanOut = tanIn - K * h;
            return Math.atan(tanOut);
        }

        // 球面（凸/凹）：近轴线性偏折 + 边缘球差（边缘多偏折）
        // 球差随曲率增大而增大：SA = 0.35·c²（c 为 0~1 的曲率）
        const c = lens.curvature / 100;
        const sa = CONFIG.PHYSICS.SA_COEFFICIENT * c * c * h * h;
        const tanOut = tanIn - K * h * (1 + sa);
        return Math.atan(tanOut);
    },

    /**
     * 计算光线与透镜平面的交点
     */
    calculateRayLensIntersection(rayX, rayY, rayAngle, lens) {
        const lensX = lens.x;
        const lensY = lens.y;
        const halfHeight = lens.getHeight() / 2;

        const dirX = Math.cos(rayAngle);
        const dirY = Math.sin(rayAngle);

        if (Math.abs(dirX) < 0.001) {
            return null;
        }

        const dx = lensX - rayX;

        // 光线必须朝向透镜
        if ((dx > 0 && dirX < 0) || (dx < 0 && dirX > 0)) {
            return null;
        }

        // 距离太近跳过
        if (Math.abs(dx) < 5) {
            return null;
        }

        const t = dx / dirX;
        const intersectY = rayY + t * dirY;

        // 检查是否在透镜范围内
        if (intersectY < lensY - halfHeight || intersectY > lensY + halfHeight) {
            return null;
        }

        return {
            x: lensX,
            y: intersectY,
            distance: Math.abs(dx)
        };
    },

    /**
     * 生成平行光线（从左边界射入，angle 为相对光轴的倾角，单位度）
     *
     * 有透镜时以第一片透镜的孔径为目标：让整束斜平行光在透镜位置
     * 均匀覆盖孔径，起点 y 由直线反推得到——这样在有效角度范围内
     * 每条光线都能打在透镜上，色散与球差可在同一条光路上对比观察。
     * 无透镜时退化为在画布高度上均匀分布。
     *
     * @param {object} [target] 第一片透镜 { x, y, halfHeight }
     */
    generateParallelRays(canvasHeight, rayCount, angle, target = null) {
        const rays = [];
        const angleRad = Utils.degToRad(angle);
        const tanA = Math.tan(angleRad);
        const cover = 0.9; // 两端留 10% 边距

        for (let i = 1; i <= rayCount; i++) {
            let y;
            if (target) {
                const t = rayCount === 1 ? 0 : -cover + 2 * cover * (i - 1) / (rayCount - 1);
                const yAtLens = target.y + t * target.halfHeight;
                y = yAtLens - target.x * tanA;
            } else {
                y = canvasHeight / (rayCount + 1) * i;
            }
            rays.push({ x: 0, y, angle: angleRad });
        }
        return rays;
    },

    /**
     * 生成点光源光线
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
     * 光线追迹分析器 —— 与画布渲染共用 calculateRefractedAngle，
     * 保证“看到的”和“判定的”是同一套光学规律。
     *
     * 对一片透镜，在全孔径上追迹平行光（可带倾角），
     * 分别计算红/绿/蓝三色光的出射角、与光轴交点、后焦面高度等。
     *
     * @param {object} lens 透镜
     * @param {number} incidentAngleDeg 入射倾角（度）
     * @param {number} [samples=9] 采样光线数
     * @returns {object} 分析结果
     */
    analyzeLens(lens, incidentAngleDeg = 0, samples = 9) {
        const halfHeight = lens.getHeight() / 2;
        const theta = Utils.degToRad(incidentAngleDeg);
        const tanTheta = Math.tan(theta);
        const isPlano = lens.type === CONFIG.LENS_TYPES.PLANO;
        const isConcave = lens.type === CONFIG.LENS_TYPES.CONCAVE;
        const isAspheric = lens.type === CONFIG.LENS_TYPES.ASPHERIC;

        const colors = ['red', 'green', 'blue'];
        const byColor = {};

        colors.forEach(color => {
            const rays = [];
            const crossings = []; // 每条光线与光轴交点的 x（透镜后）

            for (let i = 0; i < samples; i++) {
                const h = samples === 1 ? 0 : -0.9 + 1.8 * i / (samples - 1);
                const hitY = lens.y + h * halfHeight;
                const outAngle = this.calculateRefractedAngle(theta, hitY, lens, color);
                const tanOut = Math.tan(outAngle);
                rays.push({ h, outAngle });

                // 与光轴交点：y=0（归一化）→ x_c = −h/tanOut
                if (Math.abs(tanOut) > 1e-6) {
                    crossings.push(-h / tanOut);
                }
            }

            // 近轴（h≈0）焦距
            const center = rays[Math.floor(rays.length / 2)];
            const n = this.calculateDispersionIndex(lens.refractiveIndex, lens.abbeNumber, color);
            const K = this.calculatePower(n, lens.curvature) * (isConcave ? -1 : 1);
            const paraxialF = isPlano ? Infinity : halfHeight / K;

            // 后焦面（绿近轴焦面）上各光线高度（归一化）：h_fp = h + fp·tanOut
            // 后焦面位置由调用方按绿光填入，这里先给自身近轴焦面的散布
            let focusSpread = 0;
            if (isFinite(paraxialF) && !isPlano) {
                const heightsAtFp = rays.map(r => r.h + paraxialF / halfHeight * Math.tan(r.outAngle));
                const mean = heightsAtFp.reduce((a, b) => a + b, 0) / heightsAtFp.length;
                focusSpread = Math.max(...heightsAtFp.map(v => Math.abs(v - mean)));
            }

            // 斜入射交会点（所有光线共同会聚处，像素坐标）：
            // x_int = −h·halfHeight / (tanOut − tanθ)
            // 非球面与 h 无关；球面因球差随 h 变化（即轴向球差/彗差）
            let meetX = paraxialF;
            let meetYOffset = 0;
            if (!isPlano) {
                const meetXs = rays
                    .map(r => -r.h * halfHeight / (Math.tan(r.outAngle) - tanTheta))
                    .filter(v => isFinite(v) && Math.abs(v) < 1e6);
                if (meetXs.length) {
                    meetX = meetXs.reduce((a, b) => a + b, 0) / meetXs.length;
                }
                meetYOffset = meetX * tanTheta / halfHeight; // 归一化横向偏移
            }

            // 边缘光线焦距（取最边缘两条与光轴交点）
            const positiveCrossings = crossings
                .map((x, idx) => ({ x, h: rays[idx].h }))
                .filter(r => r.h > 0.5 && isFinite(r.x));
            const marginalF = positiveCrossings.length
                ? positiveCrossings[positiveCrossings.length - 1].x * halfHeight
                : paraxialF;

            // 后焦面上的高度（归一化，相对透镜中心）
            const focalPlaneOffset = isFinite(paraxialF)
                ? paraxialF / halfHeight * tanTheta
                : tanTheta;

            byColor[color] = {
                rays,
                paraxialF,
                marginalF,
                focusSpread,           // 自身近轴焦面上光线高度散布（归一化）
                meetX,                 // 斜入射会聚点 x（像素）
                meetYOffset,           // 斜入射会聚点横向偏移（归一化高度）
                focalPlaneOffset,      // 后焦面轴外高度（归一化）
                centerOutAngle: center ? center.outAngle : theta
            };
        });

        const green = byColor.green;

        // 色散度量：绿光后焦面上、红/蓝边缘光线（h=0.9）的高度错开（相对半孔径）
        // 薄透镜几何下该错开 ≈ Δn/(n−1) = 增益/阿贝数，
        // 只由材料阿贝数决定（阿贝数越小色散越强），与曲率无关。
        // 斜入射时画布上还会额外看到三色焦点横向错开 Δf·tanθ，更直观。
        let dispersionSeparation = 0;
        if (!isPlano && isFinite(green.paraxialF)) {
            const fp = green.paraxialF / halfHeight;
            const edgeAtFp = color => {
                // 取最靠近 +0.9 高度的采样光线
                const ray = byColor[color].rays
                    ? byColor[color].rays.reduce((best, r) =>
                        Math.abs(r.h - 0.9) < Math.abs(best.h - 0.9) ? r : best)
                    : null;
                return ray ? 0.9 + fp * Math.tan(ray.outAngle) : 0;
            };
            dispersionSeparation = Math.abs(edgeAtFp('blue') - edgeAtFp('red'));
        }

        // 球差：边缘光线焦距相对近轴焦距的偏差（凸透镜为正球差）
        let sphericalAberration = 0;
        if (!isPlano && !isConcave && isFinite(green.paraxialF) && green.paraxialF !== 0) {
            sphericalAberration = Math.abs(green.marginalF - green.paraxialF) / Math.abs(green.paraxialF);
        }

        return {
            isPlano,
            isConcave,
            isAspheric,
            halfHeight,
            paraxialFocalLength: green.paraxialF,
            focalPoint: {
                x: lens.x + (isFinite(green.paraxialF) ? green.paraxialF : 0),
                y: lens.y + (isFinite(green.paraxialF) ? green.paraxialF * tanTheta : 0)
            },
            byColor,
            dispersionSeparation,                 // 后焦面红蓝分离（相对半孔径）
            sphericalAberration,                  // 球差比率
            focusSpread: green.focusSpread        // 绿近轴焦面上的光线散布（相对半孔径）
        };
    },

    /**
     * 根据透镜孔径计算允许的最大入射倾角（度）
     * 斜光束两端光线（落在透镜 ±90% 孔径处）从左边界反推的起点
     * 必须仍在画布内：|x_l·tanθ| ≤ 画布半高 − 透镜偏心 − 端缘余量
     */
    calculateMaxIncidentAngle(lenses, canvasHeight) {
        if (!lenses || lenses.length === 0) {
            return CONFIG.PHYSICS.MAX_ANGLE_FALLBACK;
        }
        const first = lenses.reduce((a, b) => (a.x < b.x ? a : b));
        const half = first.getHeight() / 2;
        const centerOffset = Math.abs(first.y - canvasHeight / 2);
        const available = canvasHeight / 2 - centerOffset - half * 0.9 - 4;

        if (available <= 0) return 5;
        const maxRad = Math.atan2(available, Math.max(first.x, 60));
        return Utils.clamp(Utils.radToDeg(maxRad), 5, CONFIG.PHYSICS.MAX_ANGLE_FALLBACK);
    }
};
