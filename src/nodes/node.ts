import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { delay } from "../utils";
import { Value, NodeState } from "../types";

// Fonction pour créer un nœud du réseau
export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Route pour obtenir le statut actuel du nœud
  node.get("/status", (req, res) => {
    // Si le nœud est défectueux, renvoie un statut d'erreur, sinon renvoie "live"
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // On initialise l'état du nœud
  let state: NodeState = { killed: false, x: null, decided: null, k: null };
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Route pour recevoir des messages d'autres nœuds
  node.post("/message", (req, res) => {
    let { k, x, messageType } = req.body;
    // On vérifie si le nœud est actif et non défectueux
    if (!isFaulty && !state.killed) {
      if (messageType == "propose") {
        // On traite les messages de proposition
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x);
        let proposal = proposals.get(k)!;
        if (proposal.length >= (N - F)) {
          // On commence le vote
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ k: k, x: x, messageType: "vote" }),
            });
          }
        }
      } else if (messageType == "vote") {
        // On traite les messages de vote
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x);
        let vote = votes.get(k)!;
        if (vote.length >= (N - F)) {
          // Si consensus atteint sur le vote
          let count0 = vote.filter((el) => el == 0).length;
          let count1 = vote.filter((el) => el == 1).length;
          if (count0 >= F + 1) {
            state.x = 0;
            state.decided = true;
          } else if (count1 >= F + 1) {
            state.x = 1;
            state.decided = true;
          } else {
            if (count0 + count1 > 0 && count0 > count1) {
              state.x = 0;
            } else if (count0 + count1 > 0 && count0 < count1) {
              state.x = 1;
            } else {
              state.x = Math.random() > 0.5 ? 0 : 1;
            }
            state.k = k + 1;
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ k: state.k, x: state.x, messageType: "propose" }),
              });
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  // Route pour démarrer l'algorithme de consensus
  node.get("/start", async (req, res) => {
    // On attend que tous les nœuds soient prêts
    while (!nodesAreReady()) {
      await delay(5);
    }
    if (!isFaulty) {
      // On démarre l'algorithme de consensus
      state.k = 1;
      state.x = initialValue;
      state.decided = false;
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ k: state.k, x: state.x, messageType: "propose" }),
        });
      }
    } else {
      // Si le nœud est défectueux, on réinitialise son état
      state.decided = null;
      state.x = null;
      state.k = null;
    }
    res.status(200).send("Consensus algorithm started.");
  });

  // Route pour arrêter l'algorithme de consensus
  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("killed");
  });

  // Route pour obtenir l'état actuel du nœud
  node.get("/getState", (req, res) => {
    res.status(200).send({
      killed: state.killed,
      x: state.x,
      decided: state.decided,
      k: state.k,
    });
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}