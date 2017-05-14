/**
 * Plugin to transform function applications into `apply` calls and define
 * `apply` at the top-level as stoppable.
 */

import {NodePath, VisitNode, Visitor} from 'babel-traverse';
import * as t from 'babel-types';
import * as b from 'babylon';

const stopApplyVisitor : Visitor = {
    CallExpression: function (path: NodePath<t.CallExpression>): void {
        const applyId = t.identifier('apply');
        const applyArgs = [path.node.callee, ...path.node.arguments];
        const applyCall = t.callExpression(applyId, applyArgs);
        path.node.callee = applyId;
        path.node.arguments = applyArgs;
    }
}

module.exports = function() {
    return { visitor: stopApplyVisitor };
};