/**
 * 光路渲染器
 *
 * 所有光路绘制与焦点标注均调用 Physics 中的同一套薄透镜传递规律，
 * 测验判定也复用这些函数，保证"所见即所判"。
 */
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.lenses = [];
        this.lightMode = CONFIG.LIGHT_DEFAULTS.mode;
        this.rayCount = CONFIG.LIGHT_DEFAULTS.rayCount;
        this.incidentAngle = CONFIG.LIGHT_DEFAULTS.angle;
        this.isRunning = false;
        this.showLabels = true;
        this.showDispersion = false;
        this.simpleMode = false;
        this.compareAberration = false; // 球面/非球面同光路对比

        this.resize();
    }

    resize() {
        const wrapper = this.canvas.parentElement;
        const rect = wrapper.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;

        this.render();
    }

    setLenses(lenses) {
        this.lenses = lenses;
        this.render();
    }

    setLightMode(mode) {
        this.lightMode = mode;
        this.render();
    }

    setRayCount(count) {
        this.rayCount = count;
        this.render();
    }

    setIncidentAngle(angle) {
        this.incidentAngle = angle;
        this.render();
    }

    /**
     * 当前光路有效的入射倾角范围（度）
     */
    getEffectiveAngleRange() {
        return Physics.effectiveAngleRange(this.lenses, this.width, this.height);
    }

    toggleRunning() {
        this.isRunning = !this.isRunning;
        this.render();
        return this.isRunning;
    }

    setRunning(running) {
        this.isRunning = running;
        this.render();
    }

    toggleLabels() {
        this.showLabels = !this.showLabels;
        this.render();
        return this.showLabels;
    }

    setShowDispersion(show) {
        this.showDispersion = show;
        this.render();
    }

    setSimpleMode(simple) {
        this.simpleMode = simple;
        this.render();
    }

    setCompareAberration(compare) {
        this.compareAberration = compare;
        this.render();
    }

    render() {
        this.clear();
        this.drawGrid();
        this.drawOpticalAxis();

        if (this.isRunning) {
            this.drawLightRays();
        }

        this.drawLenses();

        if (this.showLabels && this.isRunning) {
            this.drawLabels();
        }
    }

    clear() {
        this.ctx.fillStyle = '#FAFAFA';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    drawGrid() {
        if (this.simpleMode) return;

        const gridSize = 40;
        this.ctx.strokeStyle = CONFIG.COLORS.GRID;
        this.ctx.lineWidth = 0.5;

        for (let x = gridSize; x < this.width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }

        for (let y = gridSize; y < this.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }
    }

    drawOpticalAxis() {
        const centerY = this.height / 2;

        this.ctx.strokeStyle = CONFIG.COLORS.OPTICAL_AXIS;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);

        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);
        this.ctx.lineTo(this.width, centerY);
        this.ctx.stroke();

        this.ctx.setLineDash([]);
    }

    drawLenses() {
        this.lenses.forEach(lens => this.drawLens(lens));
    }

    drawLens(lens) {
        const ctx = this.ctx;
        const x = lens.x;
        const y = lens.y;
        const width = lens.getWidth();
        const halfHeight = lens.getHeight() / 2;

        ctx.save();

        let fillColor = CONFIG.COLORS.LENS_FILL;
        let strokeColor = CONFIG.COLORS.LENS_STROKE;

        if (lens.material === 'lowDispersion') {
            fillColor = 'rgba(93, 122, 58, 0.3)';
            strokeColor = '#5D7A3A';
        } else if (lens.material === 'highIndex') {
            fillColor = 'rgba(93, 78, 140, 0.3)';
            strokeColor = '#5D4E8C';
        }

        if (lens.selected) {
            strokeColor = CONFIG.COLORS.LENS_SELECTED;
            ctx.shadowColor = CONFIG.COLORS.LENS_SELECTED;
            ctx.shadowBlur = 10;
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = CONFIG.RENDER.LENS_STROKE_WIDTH;

        ctx.beginPath();

        switch (lens.type) {
            case CONFIG.LENS_TYPES.CONVEX:
                this.drawConvexLens(ctx, x, y, width, halfHeight, lens.curvature);
                break;
            case CONFIG.LENS_TYPES.CONCAVE:
                this.drawConcaveLens(ctx, x, y, width, halfHeight, lens.curvature);
                break;
            case CONFIG.LENS_TYPES.PLANO:
                this.drawPlanoLens(ctx, x, y, halfHeight);
                break;
            case CONFIG.LENS_TYPES.ASPHERIC:
                this.drawAsphericLens(ctx, x, y, width, halfHeight, lens.curvature);
                break;
        }

        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 对比模式下，用虚线描出"另一种"透镜（凸透镜↔非球面）的轮廓
     */
    drawGhostLens(lens, ghostType) {
        const ctx = this.ctx;
        const x = lens.x;
        const y = lens.y;
        const width = lens.getWidth();
        const halfHeight = lens.getHeight() / 2;

        ctx.save();
        ctx.strokeStyle = '#8E44AD';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();

        if (ghostType === CONFIG.LENS_TYPES.ASPHERIC) {
            this.drawAsphericLens(ctx, x, y, width, halfHeight, lens.curvature);
        } else {
            this.drawConvexLens(ctx, x, y, width, halfHeight, lens.curvature);
        }

        ctx.stroke();
        ctx.restore();
    }

    drawConvexLens(ctx, x, y, width, halfHeight, curvature) {
        const curveAmount = width * (curvature / 100);
        ctx.moveTo(x, y - halfHeight);
        ctx.quadraticCurveTo(x + curveAmount, y, x, y + halfHeight);
        ctx.quadraticCurveTo(x - curveAmount, y, x, y - halfHeight);
    }

    drawConcaveLens(ctx, x, y, width, halfHeight, curvature) {
        const curveAmount = width * (curvature / 100) * 0.5;
        const edgeWidth = width * 0.3;
        ctx.moveTo(x - edgeWidth, y - halfHeight);
        ctx.quadraticCurveTo(x + curveAmount, y, x - edgeWidth, y + halfHeight);
        ctx.lineTo(x + edgeWidth, y + halfHeight);
        ctx.quadraticCurveTo(x - curveAmount, y, x + edgeWidth, y - halfHeight);
        ctx.closePath();
    }

    drawPlanoLens(ctx, x, y, halfHeight) {
        ctx.rect(x - 4, y - halfHeight, 8, halfHeight * 2);
    }

    drawAsphericLens(ctx, x, y, width, halfHeight, curvature) {
        const curveAmount = width * (curvature / 100);
        ctx.moveTo(x, y - halfHeight);
        ctx.bezierCurveTo(x + curveAmount * 0.8, y - halfHeight * 0.3, x + curveAmount * 0.8, y + halfHeight * 0.3, x, y + halfHeight);
        ctx.bezierCurveTo(x - curveAmount * 0.8, y + halfHeight * 0.3, x - curveAmount * 0.8, y - halfHeight * 0.3, x, y - halfHeight);
    }

    /**
     * 光束遇到的第一个（最靠左）透镜，用于生成覆盖口径的平行光
     */
    firstLens() {
        if (this.lenses.length === 0) return null;
        return this.lenses.reduce((a, b) => (a.x <= b.x ? a : b));
    }

    drawLightRays() {
        let rays;

        if (this.lightMode === CONFIG.LIGHT_MODES.PARALLEL) {
            const first = this.firstLens();
            const cover = first
                ? { x: first.x, y: first.y, halfHeight: first.getHeight() / 2 }
                : null;
            rays = Physics.generateParallelRays(
                this.height, this.rayCount, this.incidentAngle, cover, this.width
            );
        } else {
            rays = Physics.generatePointSourceRays(50, this.height / 2, this.rayCount);
        }

        // 整束光的倾角：平行光用入射角；点光源主光线沿光轴（u=0）
        const bundleAngle = this.lightMode === CONFIG.LIGHT_MODES.PARALLEL
            ? this.incidentAngle
            : 0;

        const hasDispersiveLens = this.lenses.some(l => l.dispersion > 0.05);

        if (this.showDispersion && hasDispersiveLens) {
            // 色散模式：分别追踪红、绿、蓝三色光，蓝光最后绘制在最上层
            ['red', 'green', 'blue'].forEach(color => {
                rays.forEach(ray => this.traceRay(ray, {
                    color,
                    bundleAngle
                }));
            });
        } else {
            rays.forEach(ray => this.traceRay(ray, { bundleAngle }));
        }

        // 球面 / 非球面同光路对比：用紫色虚线叠加"另一种"透镜的光路与轮廓
        if (this.compareAberration) {
            const compareLensIds = new Set();
            this.lenses.forEach(l => {
                if (l.type === CONFIG.LENS_TYPES.CONVEX ||
                    l.type === CONFIG.LENS_TYPES.ASPHERIC) {
                    compareLensIds.add(l.id);
                    this.drawGhostLens(
                        l,
                        l.type === CONFIG.LENS_TYPES.CONVEX
                            ? CONFIG.LENS_TYPES.ASPHERIC
                            : CONFIG.LENS_TYPES.CONVEX
                    );
                }
            });

            rays.forEach(ray => this.traceRay(ray, {
                bundleAngle,
                dashed: true,
                compareLensIds
            }));
        }
    }

    /**
     * 追踪并绘制单条光线（支持多透镜、色散、球面/非球面对比）
     *
     * @param {object} ray {x, y, angle}
     * @param {object} options
     *   - color: 'red'|'green'|'blue' 色散颜色；不给则入射红、折射蓝
     *   - bundleAngle: 光束倾角（度），决定斜入射像差
     *   - dashed: 对比光路（灰色虚线）
     *   - compareLensIds: Set，命中这些透镜时改用"另一种"曲面类型计算
     */
    traceRay(ray, options = {}) {
        const ctx = this.ctx;
        const {
            color = null,
            bundleAngle = 0,
            dashed = false,
            compareLensIds = null
        } = options;

        let rayX = ray.x;
        let rayY = ray.y;
        let rayAngle = ray.angle;
        let lastLensId = null;

        const bundleRad = Utils.degToRad(bundleAngle);

        ctx.lineWidth = CONFIG.RENDER.RAY_WIDTH;
        if (dashed) {
            ctx.strokeStyle = 'rgba(142, 68, 173, 0.85)';
            ctx.setLineDash([5, 4]);
        } else if (color) {
            ctx.strokeStyle = CONFIG.COLORS[`RAY_${color.toUpperCase()}`];
        } else {
            ctx.strokeStyle = CONFIG.COLORS.INCIDENT_RAY;
        }

        ctx.beginPath();
        ctx.moveTo(rayX, rayY);

        for (let i = 0; i < 20; i++) {
            let nearest = null;
            let nearestLens = null;
            let minDist = Infinity;

            for (const lens of this.lenses) {
                if (lens.id === lastLensId) continue;

                const hit = Physics.calculateRayLensIntersection(rayX, rayY, rayAngle, lens);
                if (hit && hit.distance < minDist) {
                    minDist = hit.distance;
                    nearest = hit;
                    nearestLens = lens;
                }
            }

            if (!nearest) break;

            ctx.lineTo(nearest.x, nearest.y);
            ctx.stroke();

            // 该颜色光的折射率（阿贝数越小，蓝-红差异越大）
            let activeIndex = nearestLens.refractiveIndex;
            if (color) {
                activeIndex = Physics.calculateDispersionIndex(
                    nearestLens.refractiveIndex,
                    nearestLens.dispersion,
                    color,
                    nearestLens.abbeNumber
                );
            }

            // 对比模式：命中凸/非球透镜时改用另一曲面类型
            let effectiveType = null;
            if (compareLensIds && compareLensIds.has(nearestLens.id)) {
                effectiveType = nearestLens.type === CONFIG.LENS_TYPES.CONVEX
                    ? CONFIG.LENS_TYPES.ASPHERIC
                    : CONFIG.LENS_TYPES.CONVEX;
            }

            rayAngle = Physics.calculateRefractedAngle(
                rayAngle, nearest.y, nearestLens, bundleRad, effectiveType, activeIndex
            );

            rayX = nearest.x;
            rayY = nearest.y;
            lastLensId = nearestLens.id;

            if (!color && !dashed) {
                ctx.strokeStyle = CONFIG.COLORS.REFRACTED_RAY;
            }

            ctx.beginPath();
            ctx.moveTo(rayX, rayY);
        }

        // 画到画布边缘
        const dirX = Math.cos(rayAngle);
        const dirY = Math.sin(rayAngle);
        let endX, endY;

        if (Math.abs(dirX) > 0.001) {
            endX = dirX > 0 ? this.width + 50 : -50;
            endY = rayY + dirY * (endX - rayX) / dirX;
        } else {
            endX = rayX;
            endY = dirY > 0 ? this.height + 50 : -50;
        }

        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /**
     * 焦点、色散焦斑与球差/彗差标注
     */
    drawLabels() {
        const ctx = this.ctx;

        ctx.fillStyle = CONFIG.COLORS.OPTICAL_AXIS;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('光轴', 10, this.height / 2 - 8);

        const angleDeg = this.lightMode === CONFIG.LIGHT_MODES.PARALLEL
            ? this.incidentAngle
            : 0;

        this.lenses.forEach(lens => {
            if (lens.type === CONFIG.LENS_TYPES.PLANO) return;
            this.drawFocalMarks(lens, angleDeg);
        });

        if (this.showDispersion && this.lenses.some(l => l.dispersion > 0.05)) {
            this.drawDispersionLegend();
        }
    }

    /**
     * 绘制单个透镜的焦点与像差标注
     */
    drawFocalMarks(lens, angleDeg) {
        const ctx = this.ctx;
        const f = Physics.getFocalLength(lens);
        if (!isFinite(f)) return;

        const isConvex = lens.type !== CONFIG.LENS_TYPES.CONCAVE;
        const inDispersionMode = this.showDispersion && lens.dispersion > 0.05;

        if (inDispersionMode) {
            // 三色近轴焦点（蓝光焦距最短、红光最长），斜入射时沿主光线方向排开
            ['red', 'green', 'blue'].forEach(color => {
                const colorIndex = Physics.calculateDispersionIndex(
                    lens.refractiveIndex, lens.dispersion, color, lens.abbeNumber
                );
                const point = Physics.traceParaxialRay(lens, angleDeg, 0, null, colorIndex);
                if (!point) return;
                if (point.x < -20 || point.x > this.width + 20) return;

                const yOnScreen = point.y >= -20 && point.y <= this.height + 20;
                ctx.fillStyle = CONFIG.COLORS[`RAY_${color.toUpperCase()}`];
                ctx.beginPath();
                ctx.arc(point.x, point.y, CONFIG.RENDER.FOCAL_POINT_RADIUS - 1, 0, Math.PI * 2);
                ctx.fill();

                if (color === 'green' && yOnScreen) {
                    ctx.fillStyle = CONFIG.COLORS.OPTICAL_AXIS;
                    ctx.font = '11px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('F', point.x, point.y - 9);
                }
            });
        } else if (isConvex) {
            // 近轴焦点（d线），斜入射时位于焦平面上、离开光轴
            const p = Physics.traceParaxialRay(lens, angleDeg, 0);
            if (p && p.x >= -20 && p.x <= this.width + 20) {
                ctx.fillStyle = CONFIG.COLORS.FOCAL_POINT;
                ctx.beginPath();
                ctx.arc(p.x, p.y, CONFIG.RENDER.FOCAL_POINT_RADIUS, 0, Math.PI * 2);
                ctx.fill();

                if (p.y >= -10 && p.y <= this.height + 10) {
                    ctx.fillStyle = CONFIG.COLORS.OPTICAL_AXIS;
                    ctx.font = '12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('F', p.x, p.y - 10);
                }
            }
        } else {
            // 凹透镜虚焦点：入射侧空心圆环，斜入射时沿焦平面偏移
            const p = Physics.traceParaxialRay(lens, angleDeg, 0);
            if (p && p.x >= 0 && p.x <= this.width) {
                ctx.strokeStyle = CONFIG.COLORS.OPTICAL_AXIS;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, CONFIG.RENDER.FOCAL_POINT_RADIUS, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = CONFIG.COLORS.OPTICAL_AXIS;
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('F(虚)', p.x, p.y - 10);
            }
        }

        // 球差/彗差光斑：仅球面凸透镜，非球面边缘光线也交于近轴焦点
        if (isConvex && lens.type === CONFIG.LENS_TYPES.CONVEX) {
            this.drawAberrationSpread(lens, angleDeg);
        }
    }

    /**
     * 球面透镜边缘光线交点与近轴焦点的差异
     * - 水平入射：边缘交点更靠近透镜（纵向球差）
     * - 斜入射：上下边缘交点错开（彗差样轴外像差），倾角越大越明显
     */
    drawAberrationSpread(lens, angleDeg) {
        const ctx = this.ctx;
        const p = Physics.traceParaxialRay(lens, angleDeg, 0);
        if (!p) return;

        const crossings = [-0.95, 0.95]
            .map(rho => Physics.traceMarginalCrossing(lens, angleDeg, rho))
            .filter(c => c && c.x > lens.x - 5 && c.x < this.width + 20);

        if (crossings.length === 0) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(90, 90, 90, 0.85)';
        ctx.fillStyle = 'rgba(90, 90, 90, 0.85)';
        ctx.lineWidth = 1.5;

        // 近轴焦点到每个边缘交点画灰色短线
        crossings.forEach(c => {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();

            // 边缘交点小刻度
            ctx.beginPath();
            ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    /**
     * 色散图例与阿贝数说明（阿贝数越小，三色分离越明显）
     */
    drawDispersionLegend() {
        const ctx = this.ctx;
        const first = this.firstLens();
        if (!first) return;

        const lines = [
            { color: CONFIG.COLORS.RAY_RED, text: '红 C 656nm（偏折最少）' },
            { color: CONFIG.COLORS.RAY_GREEN, text: '绿 d 588nm' },
            { color: CONFIG.COLORS.RAY_BLUE, text: '蓝 F 486nm（偏折最多）' }
        ];

        const x = 12;
        let y = 20;
        ctx.save();
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';

        lines.forEach(line => {
            ctx.fillStyle = line.color;
            ctx.beginPath();
            ctx.arc(x + 4, y - 4, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#555';
            ctx.fillText(line.text, x + 14, y);
            y += 16;
        });

        const abbe = first.getAbbeNumber();
        ctx.fillStyle = '#444';
        ctx.fillText(`${first.getMaterialName()} · 阿贝数 Vd ≈ ${abbe}（越小色散越明显）`, x, y + 2);
        ctx.restore();
    }

    getLensAtPoint(x, y) {
        for (let i = this.lenses.length - 1; i >= 0; i--) {
            if (this.lenses[i].containsPoint(x, y)) {
                return this.lenses[i];
            }
        }
        return null;
    }
}
