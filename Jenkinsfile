// Portfolio pipeline (ADR 0004). NOT ACTIVE: the repository has no remote and there is no Jenkins job.
// Stages 1-8 are the scripts/ci.sh gates, same names (check: sh deploy/check-pipeline.sh).
// Stages 9-11 run only on main, with RELEASE ticked and a person's approval.
// Only main is ever built on this agent, because it deploys.
// The guard in `prepare` is a second lock only: a branch can edit this file. The first lock is
// the job itself: one Pipeline job for */main, no multibranch, no pull request or fork builds,
// and a protected main branch (see deploy/README.md).
// Needed on the agent before activation (see deploy/README.md): Node 26 in $JENKINS_HOME/tools/node-26,
// git, Docker with the pinned images pulled, credentials docker-hub-creds and docker-hub-namespace,
// and DEPLOY_CLI_IMAGE (docker:cli pinned as name@sha256:...).
pipeline {
    agent any

    parameters {
        booleanParam(name: 'RELEASE', defaultValue: false, description: 'Push and deploy this build (main only)')
    }

    options {
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    environment {
        PATH      = "${env.JENKINS_HOME}/tools/node-26/bin:${env.PATH}"
        DOCKER_NS = credentials('docker-hub-namespace')
    }

    stages {
        stage('prepare') {
            steps {
                script {
                    // Before anything from the repository runs.
                    def branch = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
                    if (env.CHANGE_ID || !(branch ==~ /(origin\/)?main/)) {
                        error "only main is built on this agent (branch '${branch}', change '${env.CHANGE_ID ?: ''}')"
                    }
                }
                sh 'node --version && docker version --format "{{.Server.Version}}"'
                script {
                    // The one place the image name is defined.
                    env.APP_IMAGE = sh(returnStdout: true,
                        script: 'echo "docker.io/$DOCKER_NS/portfolio:$(git rev-parse --short=8 HEAD)"').trim()
                }
                sh 'sh deploy/check-pipeline.sh'
                sh 'sh deploy/check-scripts.sh'
            }
        }

        stage('1: install from the lockfile') { steps { sh 'sh scripts/ci.sh 1' } }
        stage('2: typecheck') { steps { sh 'sh scripts/ci.sh 2' } }
        stage('3: tests on SQLite') { steps { sh 'sh scripts/ci.sh 3' } }
        stage('4: tests on a throwaway PostgreSQL') { steps { sh 'sh scripts/ci.sh 4' } }
        stage('5: build and bundle budget') { steps { sh 'sh scripts/ci.sh 5' } }
        stage('6: image build') { steps { sh 'sh scripts/ci.sh 6' } }
        stage('7: secret and vulnerability scan') { steps { sh 'sh scripts/ci.sh 7' } }
        stage('8: read-only run check') { steps { sh 'sh scripts/ci.sh 8' } }

        stage('release') {
            when {
                beforeInput true
                allOf {
                    expression { params.RELEASE }
                    expression { env.GIT_BRANCH ==~ /(origin\/)?main/ }
                }
            }
            input {
                message 'Push this image and deploy it?'
                ok 'Release'
            }
            stages {
                stage('9: push the image') {
                    steps {
                        withCredentials([usernamePassword(credentialsId: 'docker-hub-creds',
                                usernameVariable: 'HUB_USER', passwordVariable: 'HUB_TOKEN')]) {
                            sh '''
                                set -eu
                                DOCKER_CONFIG="$(mktemp -d)"
                                export DOCKER_CONFIG
                                trap 'rm -rf "$DOCKER_CONFIG"' EXIT
                                printf '%s' "$HUB_TOKEN" | docker login -u "$HUB_USER" --password-stdin
                                docker push "$APP_IMAGE"
                            '''
                        }
                    }
                }
                stage('10: back up and deploy') {
                    steps {
                        // Jenkins runs in Docker on the same VPS: files go in and deploy.sh runs
                        // through the Docker socket. deploy.sh dumps first and rolls back on failure.
                        // A rollback is checked inside the stack only (no public URL check).
                        // Stage 11 undoes only a switch made here; a redeploy of the same image stays.
                        sh '''
                            set -eu
                            case "${DEPLOY_CLI_IMAGE:-}" in
                                *@sha256:*) ;;
                                *) echo 'DEPLOY_CLI_IMAGE must be docker:cli pinned by digest' >&2; exit 1 ;;
                            esac
                            tar -cf - -C deploy compose.yaml env.example bootstrap-env.sh deploy.sh \
                                post-deploy-check.sh checks/probe.mjs postgres-init backup |
                              docker run --rm -i --memory 64m -v /docker/portfolio:/docker/portfolio "$DEPLOY_CLI_IMAGE" \
                                sh -c 'tar -xof - -C /docker/portfolio && cd /docker/portfolio &&
                                       chmod 755 checks postgres-init backup postgres-init/*.sh && chmod 644 checks/* backup/*'
                            docker run --rm --memory 256m -v /docker/portfolio:/docker/portfolio \
                                -v /var/run/docker.sock:/var/run/docker.sock "$DEPLOY_CLI_IMAGE" \
                                sh /docker/portfolio/deploy.sh "$APP_IMAGE"
                        '''
                    }
                }
                stage('11: post-deploy checks') {
                    steps {
                        sh '''
                            set -eu
                            docker run --rm --memory 256m -e PUBLIC_CHECK=1 -v /docker/portfolio:/docker/portfolio \
                                -v /var/run/docker.sock:/var/run/docker.sock "$DEPLOY_CLI_IMAGE" \
                                sh -c 'sh /docker/portfolio/post-deploy-check.sh "$1" ||
                                       { sh /docker/portfolio/deploy.sh --undo "$1"; exit 1; }' check "$APP_IMAGE"
                        '''
                    }
                }
            }
        }
    }

    post {
        failure { echo 'Pipeline failed. If stage 10 or 11 ran, read /docker/portfolio/releases.log.' }
    }
}
