FROM node:24-slim

WORKDIR /game

RUN mkdir -p /data && chown -R node:node /data

COPY --chown=node:node game.html chay-game.js quan-tri.js volam-admin-account.cjs cau-hinh.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node may-chu ./may-chu

ENV VL_DU_LIEU=/data

EXPOSE 8101

USER node

CMD ["node", "chay-game.js", "8101", "--lan", "--no-open"]
