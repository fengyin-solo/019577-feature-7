/**
 * 光学测验管理器
 * 
 * 功能：
 * - 随机选择测验题目
 * - 验证用户答案（透镜类型、参数、光线模式等）
 * - 评分并给出详细解释
 * - 提供提示功能
 * - 记录答题历史
 */
class QuizManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.renderer = canvasManager.getRenderer();
        this.currentQuestion = null;
        this.questionHistory = [];
        this.score = 0;
        this.totalQuestions = 0;
        this.hintUsed = false;
        this.isQuizMode = false;
        this.answeredQuestions = new Set();
    }
    
    /**
     * 开启测验模式
     */
    startQuizMode() {
        this.isQuizMode = true;
        this.score = 0;
        this.totalQuestions = 0;
        this.answeredQuestions.clear();
        this.nextQuestion();
    }
    
    /**
     * 关闭测验模式
     */
    stopQuizMode() {
        this.isQuizMode = false;
        this.currentQuestion = null;
        this.hintUsed = false;
        window.dispatchEvent(new CustomEvent('quizStopped'));
    }
    
    /**
     * 获取下一道随机题目
     */
    nextQuestion() {
        const questions = CONFIG.QUIZ_QUESTIONS;
        let availableQuestions = questions.filter(q => !this.answeredQuestions.has(q.id));
        
        if (availableQuestions.length === 0) {
            this.answeredQuestions.clear();
            availableQuestions = questions;
        }
        
        const randomIndex = Math.floor(Math.random() * availableQuestions.length);
        this.currentQuestion = availableQuestions[randomIndex];
        this.hintUsed = false;
        
        this.answeredQuestions.add(this.currentQuestion.id);
        
        window.dispatchEvent(new CustomEvent('questionChanged', {
            detail: this.currentQuestion
        }));
        
        return this.currentQuestion;
    }
    
    /**
     * 获取提示
     */
    getHint() {
        if (!this.currentQuestion) return null;
        
        this.hintUsed = true;
        const hints = this.currentQuestion.hints;
        const randomIndex = Math.floor(Math.random() * hints.length);
        
        return hints[randomIndex];
    }
    
    /**
     * 验证用户答案
     */
    submitAnswer() {
        if (!this.currentQuestion) {
            return {
                isCorrect: false,
                score: 0,
                explanation: '请先选择一道题目',
                details: []
            };
        }
        
        const question = this.currentQuestion;
        const validation = question.validation;
        const requirements = question.requirements;
        const lenses = this.canvasManager.lenses;
        const lightMode = this.renderer.lightMode;
        
        const results = [];
        let isCorrect = true;
        let explanationKey = 'correct';
        
        if (lenses.length === 0) {
            return {
                isCorrect: false,
                score: 0,
                explanation: '请先在画布上添加一个透镜，然后再提交答案。',
                details: []
            };
        }
        
        const lens = lenses[0];
        
        if (validation.checkType) {
            const typeCorrect = lens.type === requirements.lensType;
            results.push({
                name: '透镜类型',
                expected: this.getLensTypeName(requirements.lensType),
                actual: lens.getTypeName(),
                correct: typeCorrect
            });
            
            if (!typeCorrect) {
                isCorrect = false;
                explanationKey = 'wrongType';
            }
        }
        
        if (validation.checkLightMode && isCorrect) {
            const lightCorrect = lightMode === requirements.lightMode;
            results.push({
                name: '光源模式',
                expected: requirements.lightMode === 'parallel' ? '平行光' : '点光源',
                actual: lightMode === 'parallel' ? '平行光' : '点光源',
                correct: lightCorrect
            });
            
            if (!lightCorrect) {
                isCorrect = false;
                explanationKey = 'wrongLightMode';
            }
        }
        
        if (validation.checkMaterial && isCorrect) {
            const materialCorrect = lens.material === requirements.material;
            results.push({
                name: '材料类型',
                expected: this.getMaterialName(requirements.material),
                actual: lens.getMaterialName(),
                correct: materialCorrect
            });
            
            if (!materialCorrect) {
                isCorrect = false;
                explanationKey = 'wrongMaterial';
            }
        }
        
        if (validation.checkRefractiveIndex && isCorrect) {
            const ri = lens.refractiveIndex;
            const minRI = requirements.minRefractiveIndex || 1.0;
            const maxRI = requirements.maxRefractiveIndex || 2.0;
            const riCorrect = ri >= minRI && ri <= maxRI;
            
            results.push({
                name: '折射率',
                expected: `${minRI} - ${maxRI}`,
                actual: ri.toFixed(2),
                correct: riCorrect
            });
            
            if (!riCorrect) {
                isCorrect = false;
                explanationKey = 'wrongRI';
            }
        }
        
        if (validation.checkCurvature && isCorrect) {
            const curvature = lens.curvature;
            const minCurv = requirements.minCurvature || 0;
            const maxCurv = requirements.maxCurvature || 100;
            const curvCorrect = curvature >= minCurv && curvature <= maxCurv;
            
            results.push({
                name: '曲率',
                expected: `${minCurv}% - ${maxCurv}%`,
                actual: `${curvature}%`,
                correct: curvCorrect
            });
            
            if (!curvCorrect) {
                isCorrect = false;
                explanationKey = 'wrongCurvature';
            }
        }
        
        if (validation.checkConvergence && isCorrect) {
            const convergenceResult = this.checkConvergence(lens);
            results.push({
                name: '光线会聚',
                expected: '光线会聚到一点',
                actual: convergenceResult.message,
                correct: convergenceResult.converging
            });
            
            if (!convergenceResult.converging) {
                isCorrect = false;
                explanationKey = 'noConvergence';
            }
        }
        
        if (validation.checkDivergence && isCorrect) {
            const divergenceResult = this.checkDivergence(lens);
            results.push({
                name: '光线发散',
                expected: '光线向外发散',
                actual: divergenceResult.message,
                correct: divergenceResult.diverging
            });
            
            if (!divergenceResult.diverging) {
                isCorrect = false;
                explanationKey = 'noDivergence';
            }
        }
        
        if (validation.checkNoDeflection && isCorrect) {
            const noDeflectionResult = this.checkNoDeflection(lens);
            results.push({
                name: '光线偏折',
                expected: '光线方向不变',
                actual: noDeflectionResult.message,
                correct: noDeflectionResult.noDeflection
            });
            
            if (!noDeflectionResult.noDeflection) {
                isCorrect = false;
                explanationKey = 'hasDeflection';
            }
        }
        
        if (validation.checkDispersion && isCorrect) {
            const dispersionResult = this.checkDispersion(lens);
            results.push({
                name: '色散效果',
                expected: '色散现象明显',
                actual: dispersionResult.message,
                correct: dispersionResult.hasDispersion
            });
            
            if (!dispersionResult.hasDispersion) {
                isCorrect = false;
                explanationKey = 'noDispersion';
            }
        }
        
        if (validation.checkLowDispersion && isCorrect) {
            const lowDispersionResult = this.checkLowDispersion(lens);
            results.push({
                name: '低色散效果',
                expected: '色散很小',
                actual: lowDispersionResult.message,
                correct: lowDispersionResult.lowDispersion
            });
            
            if (!lowDispersionResult.lowDispersion) {
                isCorrect = false;
                explanationKey = 'highDispersion';
            }
        }
        
        if (validation.checkSphericalAberration && isCorrect) {
            const aberrationResult = this.checkSphericalAberration(lens);
            results.push({
                name: '球差现象',
                expected: '存在明显球差',
                actual: aberrationResult.message,
                correct: aberrationResult.hasAberration
            });
            
            if (!aberrationResult.hasAberration) {
                isCorrect = false;
                explanationKey = 'noAberration';
            }
        }
        
        if (validation.checkNoSphericalAberration && isCorrect) {
            const noAberrationResult = this.checkNoSphericalAberration(lens);
            results.push({
                name: '消球差效果',
                expected: '球差被消除',
                actual: noAberrationResult.message,
                correct: noAberrationResult.noAberration
            });
            
            if (!noAberrationResult.noAberration) {
                isCorrect = false;
                explanationKey = 'hasAberration';
            }
        }
        
        let earnedScore = 0;
        if (isCorrect) {
            earnedScore = this.hintUsed ? 5 : 10;
            this.score += earnedScore;
        }
        this.totalQuestions++;
        
        const explanation = question.explanation[explanationKey] || question.explanation.correct;
        
        this.questionHistory.push({
            questionId: question.id,
            title: question.title,
            isCorrect: isCorrect,
            score: earnedScore,
            hintUsed: this.hintUsed,
            timestamp: Date.now()
        });
        
        return {
            isCorrect: isCorrect,
            score: earnedScore,
            totalScore: this.score,
            totalQuestions: this.totalQuestions,
            explanation: explanation,
            details: results,
            hintUsed: this.hintUsed
        };
    }
    
    /**
     * 检查光线会聚情况
     */
    checkConvergence(lens) {
        if (lens.type !== CONFIG.LENS_TYPES.CONVEX) {
            return { converging: false, message: '需要使用凸透镜' };
        }
        
        const focalLength = lens.getFocalLength();
        const minFocal = this.currentQuestion.requirements.minFocalLength || 50;
        const maxFocal = this.currentQuestion.requirements.maxFocalLength || 500;
        
        if (focalLength < minFocal || focalLength > maxFocal) {
            return { 
                converging: false, 
                message: `焦距 ${Math.round(focalLength)}px 不在合适范围内 (${minFocal}-${maxFocal}px)` 
            };
        }
        
        const strength = (lens.refractiveIndex - 1) * (lens.curvature / 100);
        if (strength < 0.15) {
            return { converging: false, message: '会聚能力太弱，请增大折射率或曲率' };
        }
        
        return { converging: true, message: `光线会聚良好，焦距约 ${Math.round(focalLength)}px` };
    }
    
    /**
     * 检查光线发散情况
     */
    checkDivergence(lens) {
        if (lens.type !== CONFIG.LENS_TYPES.CONCAVE) {
            return { diverging: false, message: '需要使用凹透镜' };
        }
        
        const strength = (lens.refractiveIndex - 1) * (lens.curvature / 100);
        if (strength < 0.1) {
            return { diverging: false, message: '发散能力太弱，请增大折射率或曲率' };
        }
        
        return { diverging: true, message: '光线发散效果明显' };
    }
    
    /**
     * 检查光线是否无偏折（平面透镜：出射方向与入射相同，仅侧移）
     */
    checkNoDeflection(lens) {
        if (lens.type !== CONFIG.LENS_TYPES.PLANO) {
            return { noDeflection: false, message: '需要使用平面透镜' };
        }

        return { noDeflection: true, message: '出射光与入射光方向相同，只发生平行侧移' };
    }

    /**
     * 检查色散效果（真实光线追迹：绿光后焦面上红蓝边缘光线错开量）
     */
    checkDispersion(lens) {
        if (lens.type === CONFIG.LENS_TYPES.PLANO) {
            return { hasDispersion: false, message: '平面透镜不偏折光，无法观察色散' };
        }

        const angle = this.renderer.lightMode === CONFIG.LIGHT_MODES.PARALLEL
            ? this.renderer.incidentAngle : 0;
        const analysis = Physics.analyzeLens(lens, angle);
        const threshold = CONFIG.PHYSICS.THRESHOLDS.DISPERSION;

        if (analysis.dispersionSeparation < threshold) {
            return {
                hasDispersion: false,
                message: '阿贝数偏大、色散很弱，请换普通玻璃或高折射率镜片并增大曲率'
            };
        }

        return {
            hasDispersion: true,
            message: `色散明显（红蓝错开约孔径的 ${(analysis.dispersionSeparation * 100).toFixed(0)}%），蓝光偏折最多`
        };
    }

    /**
     * 检查低色散效果（阿贝数大 → 红蓝错开量小）
     */
    checkLowDispersion(lens) {
        if (lens.type === CONFIG.LENS_TYPES.PLANO) {
            return { lowDispersion: false, message: '请选用低色散材料的凸透镜' };
        }

        const angle = this.renderer.lightMode === CONFIG.LIGHT_MODES.PARALLEL
            ? this.renderer.incidentAngle : 0;
        const analysis = Physics.analyzeLens(lens, angle);
        const threshold = CONFIG.PHYSICS.THRESHOLDS.LOW_DISPERSION;

        if (analysis.dispersionSeparation >= threshold) {
            return {
                lowDispersion: false,
                message: `阿贝数偏小（Vd=${lens.abbeNumber}），色散仍明显，请使用低色散镜片`
            };
        }

        return {
            lowDispersion: true,
            message: `阿贝数 Vd=${lens.abbeNumber}，红蓝错开很小，三色光几乎重合`
        };
    }

    /**
     * 检查球差（真实追迹：球面边缘光线焦距相对近轴焦距的偏差）
     */
    checkSphericalAberration(lens) {
        if (lens.type !== CONFIG.LENS_TYPES.CONVEX) {
            return { hasAberration: false, message: '需要使用球面凸透镜' };
        }

        const angle = this.renderer.lightMode === CONFIG.LIGHT_MODES.PARALLEL
            ? this.renderer.incidentAngle : 0;
        const analysis = Physics.analyzeLens(lens, angle);
        const threshold = CONFIG.PHYSICS.THRESHOLDS.SPHERICAL_ABERRATION;

        if (analysis.sphericalAberration < threshold) {
            return {
                hasAberration: false,
                message: `球差偏弱（边缘焦点偏差 ${(analysis.sphericalAberration * 100).toFixed(1)}%），请增大曲率`
            };
        }

        return {
            hasAberration: true,
            message: `球差明显：边缘光线焦点比中心近约 ${(analysis.sphericalAberration * 100).toFixed(0)}% 焦距`
        };
    }

    /**
     * 检查消球差（非球面：各光线会聚点散布应接近0，斜入射同样成立）
     */
    checkNoSphericalAberration(lens) {
        if (lens.type !== CONFIG.LENS_TYPES.ASPHERIC) {
            return { noAberration: false, message: '需要使用非球面透镜' };
        }

        const angle = this.renderer.lightMode === CONFIG.LIGHT_MODES.PARALLEL
            ? this.renderer.incidentAngle : 0;
        const analysis = Physics.analyzeLens(lens, angle);
        const threshold = CONFIG.PHYSICS.THRESHOLDS.ASPHERIC_FOCUS_SPREAD;

        if (analysis.focusSpread >= threshold) {
            return {
                noAberration: false,
                message: `会聚点仍有散布（约孔径的 ${(analysis.focusSpread * 100).toFixed(1)}%）`
            };
        }

        return {
            noAberration: true,
            message: '各高度光线（含斜入射）会聚到同一点，球差被消除'
        };
    }

    /**
     * 获取透镜类型中文名称
     */
    getLensTypeName(type) {
        const names = {
            [CONFIG.LENS_TYPES.CONVEX]: '凸透镜',
            [CONFIG.LENS_TYPES.CONCAVE]: '凹透镜',
            [CONFIG.LENS_TYPES.PLANO]: '平面透镜',
            [CONFIG.LENS_TYPES.ASPHERIC]: '非球面透镜'
        };
        return names[type] || type;
    }
    
    /**
     * 获取材料中文名称
     */
    getMaterialName(material) {
        const names = {
            normal: '普通玻璃',
            highIndex: '高折射率镜片',
            lowDispersion: '低色散镜片'
        };
        return names[material] || material;
    }
    
    /**
     * 获取当前得分
     */
    getScore() {
        return {
            score: this.score,
            totalQuestions: this.totalQuestions,
            accuracy: this.totalQuestions > 0 
                ? Math.round((this.questionHistory.filter(q => q.isCorrect).length / this.totalQuestions) * 100)
                : 0
        };
    }
}
