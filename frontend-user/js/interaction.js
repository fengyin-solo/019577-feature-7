/**
 * 交互管理器
 */
class InteractionManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.renderer = canvasManager.getRenderer();
        this.btnToggleLight = null;
        this.lastAngleWarnAt = 0;

        this.init();
    }
    
    init() {
        this.bindLensLibraryEvents();
        this.bindToolbarEvents();
        this.bindAngleControl();
        this.bindParamPanelEvents();
        this.bindFooterEvents();
        this.bindHelpEvents();
        this.bindLensSelectionEvents();
    }
    
    bindLensLibraryEvents() {
        const lensItems = document.querySelectorAll('.lens-item');
        
        lensItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.setData('lens-type', item.dataset.lensType);
                e.dataTransfer.setData('lens-material', item.dataset.material || '');
                e.dataTransfer.effectAllowed = 'copy';
            });
            
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
            });
            
            // 触摸设备点击添加
            if (Utils.isTouchDevice()) {
                item.addEventListener('click', () => {
                    const lens = new Lens({
                        type: item.dataset.lensType,
                        x: this.renderer.width / 2,
                        y: this.renderer.height / 2,
                        material: item.dataset.material || 'normal'
                    });
                    this.canvasManager.addLens(lens);
                    this.canvasManager.selectLens(lens);
                    Utils.showToast('透镜已添加', 'success');
                });
            }
        });
    }
    
    bindToolbarEvents() {
        // 启动/暂停光路
        this.btnToggleLight = document.getElementById('btn-toggle-light');
        this.btnToggleLight.addEventListener('click', () => {
            const isRunning = this.renderer.toggleRunning();
            this.updateLightButtonState(isRunning);
        });
        
        // 重置画布
        document.getElementById('btn-reset-canvas').addEventListener('click', () => {
            if (this.canvasManager.lenses.length === 0 && !this.renderer.isRunning) {
                Utils.showToast('画布已经是空的了', 'info');
                return;
            }

            // 重置透镜
            this.canvasManager.clear();

            // 重置光线状态
            this.renderer.setRunning(false);
            this.renderer.setShowDispersion(false);
            this.renderer.setCompareAberration(false);
            this.renderer.setIncidentAngle(CONFIG.LIGHT_DEFAULTS.angle);
            document.getElementById('btn-toggle-dispersion').classList.remove('active');
            document.getElementById('btn-compare-aberration').classList.remove('active');
            if (this.angleSlider) this.angleSlider.value = CONFIG.LIGHT_DEFAULTS.angle;
            if (this.angleValue) this.angleValue.textContent = `${CONFIG.LIGHT_DEFAULTS.angle}°`;
            this.updateAngleRangeHint();
            this.updateLightButtonState(false);

            Utils.showToast('画布已重置', 'success');
        });
        
        // 光源模式选择
        const selectLightMode = document.getElementById('select-light-mode');
        selectLightMode.addEventListener('change', (e) => {
            this.renderer.setLightMode(e.target.value);
            this.updateAngleControlState(e.target.value);
        });

        // 色散开关：红/绿/蓝三色光，蓝光偏折最多
        const btnDispersion = document.getElementById('btn-toggle-dispersion');
        btnDispersion.addEventListener('click', () => {
            const show = !this.renderer.showDispersion;
            this.renderer.setShowDispersion(show);
            btnDispersion.classList.toggle('active', show);
            Utils.showToast(
                show ? '已开启色散显示：蓝、绿、红三色光分别计算' : '已关闭色散显示',
                'info'
            );
        });

        // 球面 / 非球面同光路对比
        const btnCompare = document.getElementById('btn-compare-aberration');
        btnCompare.addEventListener('click', () => {
            const hasComparable = this.canvasManager.lenses.some(l =>
                l.type === CONFIG.LENS_TYPES.CONVEX ||
                l.type === CONFIG.LENS_TYPES.ASPHERIC
            );
            if (!hasComparable) {
                Utils.showToast('请先在画布上添加凸透镜或非球面透镜', 'warning');
                return;
            }
            const compare = !this.renderer.compareAberration;
            this.renderer.setCompareAberration(compare);
            btnCompare.classList.toggle('active', compare);
            Utils.showToast(
                compare ? '紫色虚线为另一种透镜的光路，对比球差差异' : '已关闭对比光路',
                'info'
            );
        });
        
        // 切换标注
        const btnToggleLabels = document.getElementById('btn-toggle-labels');
        btnToggleLabels.addEventListener('click', () => {
            const showLabels = this.renderer.toggleLabels();
            btnToggleLabels.classList.toggle('active', showLabels);
        });
    }
    
    /**
     * 入射倾角控件
     * 倾角超出当前画布/透镜位置对应的有效范围时：
     * 立即回退滑块并保留原值，给出提示。
     */
    bindAngleControl() {
        this.angleSlider = document.getElementById('input-incident-angle');
        this.angleValue = document.getElementById('incident-angle-value');
        this.angleRangeHint = document.getElementById('angle-range-hint');
        this.angleControl = document.getElementById('angle-control');

        // 拖动过程中即时回退越界值（toast 节流避免刷屏）
        this.angleSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            const range = this.renderer.getEffectiveAngleRange();

            if (range && (value < range.min || value > range.max)) {
                const now = Date.now();
                if (now - this.lastAngleWarnAt > 800) {
                    this.lastAngleWarnAt = now;
                    this.warnAngleOutOfRange(value, range);
                }
                e.target.value = this.renderer.incidentAngle;
                return;
            }
            this.angleValue.textContent = `${value}°`;
            this.renderer.setIncidentAngle(value);
        });

        // 透镜位置/数量/画布尺寸变化后刷新有效范围提示
        window.addEventListener('sceneGeometryChanged', () => this.updateAngleRangeHint());
        this.updateAngleRangeHint();
        this.updateAngleControlState(this.renderer.lightMode);
    }

    warnAngleOutOfRange(value, range) {
        Utils.showToast(
            `倾角 ${value}° 超出有效范围（${range.min}° ~ ${range.max}°），光束无法完整照到透镜，已保留原值`,
            'warning',
            1200
        );
        this.angleValue.textContent = `${this.renderer.incidentAngle}°`;
    }

    /**
     * 根据画布与最左透镜位置计算并显示当前有效倾角范围
     */
    updateAngleRangeHint() {
        if (!this.angleRangeHint) return;
        const range = this.renderer.getEffectiveAngleRange();

        if (!range) {
            this.angleRangeHint.textContent = '';
            return;
        }
        this.angleRangeHint.textContent = `有效 ${range.min}°~${range.max}°`;

        // 动态收窄滑块物理范围
        this.angleSlider.min = range.min;
        this.angleSlider.max = range.max;

        // 透镜移动后原值可能失效：保留原值并提示
        const current = this.renderer.incidentAngle;
        if (current < range.min || current > range.max) {
            Utils.showToast(
                `透镜移动后 ${current}° 已超出有效范围（${range.min}° ~ ${range.max}°），已保留原值`,
                'warning'
            );
        }
    }

    updateAngleControlState(mode) {
        if (!this.angleControl) return;
        // 倾角只对平行光束有意义
        const parallel = mode === CONFIG.LIGHT_MODES.PARALLEL;
        this.angleControl.classList.toggle('disabled', !parallel);
        this.angleSlider.disabled = !parallel;
    }

    /**
     * 更新光线按钮状态
     */
    updateLightButtonState(isRunning) {
        this.btnToggleLight.classList.toggle('active', isRunning);
        this.btnToggleLight.querySelector('span').textContent = isRunning ? '暂停光路' : '启动光路';
        
        const icon = this.btnToggleLight.querySelector('svg');
        if (isRunning) {
            icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        } else {
            icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
        }
    }
    
    bindParamPanelEvents() {
        const riSlider = document.getElementById('param-ri');
        riSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('param-ri-value').textContent = value.toFixed(2);
            
            if (this.canvasManager.selectedLens) {
                this.canvasManager.selectedLens.refractiveIndex = value;
                this.renderer.render();
            }
        });
        
        const sizeSlider = document.getElementById('param-size');
        sizeSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('param-size-value').textContent = `${value}%`;

            if (this.canvasManager.selectedLens) {
                this.canvasManager.selectedLens.size = value;
                this.renderer.render();
                this.canvasManager.notifySceneChanged();
            }
        });
        
        const curvatureSlider = document.getElementById('param-curvature');
        curvatureSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('param-curvature-value').textContent = `${value}%`;
            
            if (this.canvasManager.selectedLens) {
                this.canvasManager.selectedLens.curvature = value;
                this.renderer.render();
            }
        });
        
        document.getElementById('param-material').addEventListener('change', (e) => {
            if (this.canvasManager.selectedLens) {
                this.canvasManager.selectedLens.applyMaterial(e.target.value);
                riSlider.value = this.canvasManager.selectedLens.refractiveIndex;
                document.getElementById('param-ri-value').textContent = 
                    this.canvasManager.selectedLens.refractiveIndex.toFixed(2);
                this.renderer.render();
            }
        });
        
        document.getElementById('btn-reset-lens').addEventListener('click', () => {
            if (this.canvasManager.selectedLens) {
                this.canvasManager.selectedLens.reset();
                this.updateParamPanel(this.canvasManager.selectedLens);
                this.renderer.render();
                this.canvasManager.notifySceneChanged();
                Utils.showToast('参数已重置', 'success');
            }
        });
        
        document.getElementById('btn-delete-lens').addEventListener('click', () => {
            if (this.canvasManager.selectedLens) {
                this.canvasManager.removeLens(this.canvasManager.selectedLens);
                Utils.showToast('透镜已删除', 'success');
            }
        });
    }
    
    bindFooterEvents() {
        // 底部区域已简化，无需绑定事件
    }
    
    bindHelpEvents() {
        document.getElementById('btn-help').addEventListener('click', () => {
            Storage.resetGuide();
            window.dispatchEvent(new CustomEvent('showGuide'));
        });
        
        document.querySelectorAll('.btn-help-small').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                Utils.showHelpTooltip(btn, btn.dataset.help);
            });
            btn.addEventListener('mouseleave', () => {
                Utils.hideHelpTooltip();
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Utils.showHelpTooltip(btn, btn.dataset.help);
                setTimeout(() => Utils.hideHelpTooltip(), 3000);
            });
        });
    }
    
    bindLensSelectionEvents() {
        window.addEventListener('lensSelected', (e) => {
            this.showParamPanel(e.detail);
        });
        
        window.addEventListener('lensDeselected', () => {
            this.hideParamPanel();
        });
    }
    
    showParamPanel(lens) {
        document.getElementById('panel-empty').classList.add('hidden');
        document.getElementById('panel-params').classList.remove('hidden');
        this.updateParamPanel(lens);
    }
    
    hideParamPanel() {
        document.getElementById('panel-empty').classList.remove('hidden');
        document.getElementById('panel-params').classList.add('hidden');
    }
    
    updateParamPanel(lens) {
        document.getElementById('param-type-value').textContent = lens.getTypeName();
        document.getElementById('param-ri').value = lens.refractiveIndex;
        document.getElementById('param-ri-value').textContent = lens.refractiveIndex.toFixed(2);
        document.getElementById('param-size').value = lens.size;
        document.getElementById('param-size-value').textContent = `${lens.size}%`;
        document.getElementById('param-curvature').value = lens.curvature;
        document.getElementById('param-curvature-value').textContent = `${lens.curvature}%`;
        document.getElementById('param-material').value = lens.material;
        
        const curvatureGroup = document.getElementById('param-curvature-group');
        curvatureGroup.style.display = lens.type === CONFIG.LENS_TYPES.PLANO ? 'none' : 'flex';
    }
}
