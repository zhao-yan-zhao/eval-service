import { validateFormula, evaluateFormulaExpression } from '../src/operators/formula-engine.ts';

const expr = "IF(OR(IdentificationStatus = 'Known'; IdentificationStatus = 'Precise'); 1.0; 0.0)";
console.log('Valid:', validateFormula(expr));
console.log('Eval Known:', evaluateFormulaExpression(expr, { IdentificationStatus: 'Known' }));
console.log('Eval Unknown:', evaluateFormulaExpression(expr, { IdentificationStatus: 'Unknown' }));
