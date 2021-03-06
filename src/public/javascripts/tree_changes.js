"use strict";

const treeChanges = (function() {
    async function moveBeforeNode(nodesToMove, beforeNode) {
        for (const nodeToMove of nodesToMove) {
            const resp = await server.put('tree/' + nodeToMove.data.noteTreeId + '/move-before/' + beforeNode.data.noteTreeId);

            if (!resp.success) {
                alert(resp.message);
                return;
            }

            changeNode(nodeToMove, node => node.moveTo(beforeNode, 'before'));
        }
    }

    async function moveAfterNode(nodesToMove, afterNode) {
        nodesToMove.reverse(); // need to reverse to keep the note order

        for (const nodeToMove of nodesToMove) {
            const resp = await server.put('tree/' + nodeToMove.data.noteTreeId + '/move-after/' + afterNode.data.noteTreeId);

            if (!resp.success) {
                alert(resp.message);
                return;
            }

            changeNode(nodeToMove, node => node.moveTo(afterNode, 'after'));
        }
    }

    async function moveToNode(nodesToMove, toNode) {
        for (const nodeToMove of nodesToMove) {
            const resp = await server.put('tree/' + nodeToMove.data.noteTreeId + '/move-to/' + toNode.data.noteId);

            if (!resp.success) {
                alert(resp.message);
                return;
            }

            changeNode(nodeToMove, node => {
                // first expand which will force lazy load and only then move the node
                // if this is not expanded before moving, then lazy load won't happen because it already contains node
                // this doesn't work if this isn't a folder yet, that's why we expand second time below
                toNode.setExpanded(true);

                node.moveTo(toNode);

                toNode.folder = true;
                toNode.renderTitle();

                // this expands the note in case it become the folder only after the move
                toNode.setExpanded(true);
            });
        }
    }

    async function deleteNodes(nodes) {
        if (nodes.length === 0 || !confirm('Are you sure you want to delete select note(s) and all the sub-notes?')) {
            return;
        }

        for (const node of nodes) {
            await server.remove('tree/' + node.data.noteTreeId);
        }

        // following code assumes that nodes contain only top-most selected nodes - getSelectedNodes has been
        // called with stopOnParent=true
        let next = nodes[nodes.length - 1].getNextSibling();

        if (!next) {
            next = nodes[0].getPrevSibling();
        }

        if (!next && !isTopLevelNode(nodes[0])) {
            next = nodes[0].getParent();
        }

        if (next) {
            // activate next element after this one is deleted so we don't lose focus
            next.setActive();

            noteTree.setCurrentNotePathToHash(next);
        }

        noteTree.reload();

        showMessage("Note(s) has been deleted.");
    }

    async function moveNodeUpInHierarchy(node) {
        if (isTopLevelNode(node)) {
            return;
        }

        const resp = await server.put('tree/' + node.data.noteTreeId + '/move-after/' + node.getParent().data.noteTreeId);

        if (!resp.success) {
            alert(resp.message);
            return;
        }

        if (!isTopLevelNode(node) && node.getParent().getChildren().length <= 1) {
            node.getParent().folder = false;
            node.getParent().renderTitle();
        }

        changeNode(node, node => node.moveTo(node.getParent(), 'after'));
    }

    function changeNode(node, func) {
        assertArguments(node.data.parentNoteId, node.data.noteId);

        noteTree.removeParentChildRelation(node.data.parentNoteId, node.data.noteId);

        func(node);

        node.data.parentNoteId = isTopLevelNode(node) ? 'root' : node.getParent().data.noteId;

        noteTree.setParentChildRelation(node.data.noteTreeId, node.data.parentNoteId, node.data.noteId);

        noteTree.setCurrentNotePathToHash(node);
    }

    return {
        moveBeforeNode,
        moveAfterNode,
        moveToNode,
        deleteNodes,
        moveNodeUpInHierarchy
    };
})();