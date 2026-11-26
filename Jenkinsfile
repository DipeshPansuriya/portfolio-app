// Portfolio pipeline (ADR 0004). NOT ACTIVE: the repository has no remote and there is no Jenkins job.
// Stages 1-8 are the scripts/ci.sh gates, same names (check: sh deploy/check-pipeline.sh).
// Stages 9-11 run only on main, with RELEASE ticked and a person's approval.
// Two agents (gate finding 1: the production Docker socket is root on the server):
//   portfolio-build   gates 1-8, run the repository's code. Its OWN Docker daemon, never the
//                     production socket, no credential. linux/amd64 like the server, and not on
//                     it (README, memory). Node 26 on PATH, git, python3, the pinned images
//                     pulled.
//   portfolio-deploy  stages 9-11, after a person's approval. Holds the production socket; checks
//                     nothing out and builds nothing: it takes the image and deploy files stashed
//                     by this run. Docker, the credential ghcr-creds (GitHub user and a token that
//                     may write packages), DEPLOY_CLI_IMAGE (docker:cli as name@sha256:...) and
//                     DEPLOY_USER (uid:gid, not root: owns /docker/portfolio, in the socket's group).
//   The controller    DEPLOY_APPROVER, a global environment variable: the user IDs (comma
//                     separated) that may approve a release. Without it no release runs.
//   Both Docker daemons use the containerd image store (deploy/load-release.sh).
// A branch can edit this file, so the guard in `prepare` is a second lock only. The first lock is
// the job: one Pipeline job for */main, no multibranch, no pull request or fork builds, main
// protected, pull requests merged by a person (no auto-merge). Server settings: deploy/README.md,
// "Jenkins server settings". NOT VERIFIED on a Jenkins server.
pipeline {
    agent none

    parameters {
        booleanParam(name: 'RELEASE', defaultValue: false, description: 'Push and deploy this build (main only)')
    }

    environment {
        // ci.sh removes no image without the list of what a server needs.
        CI_KEEP_REQUIRED = '1'
        // Gate 8 writes the ID of the image it ran here.
        IMAGE_ID_FILE = 'release-image.id'
    }

    options {
        disableConcurrentBuilds()
        skipDefaultCheckout()
                timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {
        stage('build and verify') {
            agent { label 'portfolio-build' }
            stages {
                stage('prepare') {
                    steps {
                        // Clean the workspace before checkout, so nothing from an old build
                        // reaches the stash.
                        deleteDir()
                        script {
                            // Before anything from the repository runs.
                            def source = checkout(scm)
                            env.RELEASE_BRANCH = env.BRANCH_NAME ?: source.GIT_BRANCH ?: ''
                            if (env.CHANGE_ID || !(env.RELEASE_BRANCH ==~ /(origin\/)?main/)) {
                                error "only main is built on this agent (branch '${env.RELEASE_BRANCH}', change '${env.CHANGE_ID ?: ''}')"
                            }
                        }
                        // The deploy files exactly as checked out, kept before any repository code or
                        // package runs: nothing in the gates can change what the deploy agent runs.
                        stash name: 'release-files', includes: 'deploy/**,scripts/ci.sh'
                        sh 'node --version && docker version --format "{{.Server.Version}}"'
                        script {
                            // scripts/ci.sh is the one place the image is named.
                            env.APP_IMAGE = sh(returnStdout: true, script: 'sh scripts/ci.sh --image').trim()
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
                stage('8: read-only run check') {
                    steps {
                        sh 'sh scripts/ci.sh 8'
                        // Held by the controller from here on: the deploy agent loads no
                        // other image than this one.
                        script { env.APP_IMAGE_ID = readFile('release-image.id').trim() }
                    }
                }

                stage('hand over the release') {
                    when { expression { params.RELEASE } }
                    steps {
                        // The verified image; nothing is rebuilt later.
                        sh 'docker save -o release-image.tar "$APP_IMAGE"'
                        stash name: 'release-image', includes: 'release-image.tar'
                    }
                }
            }
            post {
                always {
                    // This build agent keeps neither the image nor the file.
                    sh 'rm -f release-image.tar; [ -z "${APP_IMAGE:-}" ] || ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1 || docker image rm "$APP_IMAGE"'
                }
            }
        }

        stage('release') {
            when {
                allOf {
                    expression { params.RELEASE }
                    expression { env.RELEASE_BRANCH ==~ /(origin\/)?main/ }
                }
            }
            stages {
                // No agent, so no executor is held while waiting, and DEPLOY_APPROVER comes
                // from the controller's settings only. Inside `release`: a restart of that
                // stage asks again.
                stage('approval') {
                    steps {
                        script {
                            def approver = env.DEPLOY_APPROVER ?: ''
                            // An empty submitter would let anyone with build rights approve.
                            if (!(approver ==~ /[A-Za-z0-9._@-]+(,[A-Za-z0-9._@-]+)*/)) {
                                error 'DEPLOY_APPROVER must name the user IDs that may release (comma separated, no spaces)'
                            }
                            input message: "Push ${env.APP_IMAGE} (${env.APP_IMAGE_ID}) and deploy it?", ok: 'Release', submitter: approver
                        }
                    }
                }
                stage('on the deploy agent') {
                    agent { label 'portfolio-deploy' }
                    options { skipDefaultCheckout() }
                    stages {
                        stage('9: push the image') {
                            steps {
                                deleteDir()
                                unstash 'release-image'
                                unstash 'release-files'
                                // Refuses an archive with any other name or image (finding R1).
                                sh 'sh deploy/load-release.sh release-image.tar "$APP_IMAGE" "$APP_IMAGE_ID"'
                                withCredentials([usernamePassword(credentialsId: 'ghcr-creds',
                                        usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN')]) {
                                    sh '''
                                        set -eu
                                        DOCKER_CONFIG="$(mktemp -d)"
                                        export DOCKER_CONFIG
                                        trap 'rm -rf "$DOCKER_CONFIG"' EXIT
                                        printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
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
                                    case "${DEPLOY_USER:-}" in
                                        *[!0-9:]*) echo 'DEPLOY_USER must be uid:gid in numbers, both above 0' >&2; exit 1 ;;
                                    esac
                                    printf '%s\n' "${DEPLOY_USER:-}" | grep -qxE '[1-9][0-9]{0,8}:[1-9][0-9]{0,8}' ||
                                        { echo 'DEPLOY_USER must be uid:gid in numbers, both above 0' >&2; exit 1; }
                                    tar -cf - -C deploy compose.yaml compose.shared-db.yaml compose.shared-volume.yaml env.example \
                                        bootstrap-env.sh deploy.sh post-deploy-check.sh checks/probe.mjs postgres-init backup |
                                      docker run --rm -i --user "$DEPLOY_USER" --cap-drop ALL --security-opt no-new-privileges --read-only --network none --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 \
                                        -v /docker/portfolio:/docker/portfolio "$DEPLOY_CLI_IMAGE" \
                                        sh -c 'tar -xof - -C /docker/portfolio && cd /docker/portfolio &&
                                               chmod 755 checks postgres-init backup postgres-init/*.sh && chmod 644 checks/* backup/*'
                                    docker run --rm --user "$DEPLOY_USER" --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp -e HOME=/tmp --memory 256m --memory-reservation 32m --cpus 0.5 --cpu-shares 256 \
                                        -v /docker/portfolio:/docker/portfolio -v /var/run/docker.sock:/var/run/docker.sock "$DEPLOY_CLI_IMAGE" \
                                        sh /docker/portfolio/deploy.sh "$APP_IMAGE"
                                '''
                            }
                        }
                        stage('11: post-deploy checks') {
                            steps {
                                sh '''
                                    set -eu
                                    docker run --rm --user "$DEPLOY_USER" --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp -e HOME=/tmp --memory 256m --memory-reservation 32m --cpus 0.5 --cpu-shares 256 \
                                        -e PUBLIC_CHECK=1 -v /docker/portfolio:/docker/portfolio -v /var/run/docker.sock:/var/run/docker.sock "$DEPLOY_CLI_IMAGE" \
                                        sh -c 'sh /docker/portfolio/post-deploy-check.sh "$1" ||
                                               { sh /docker/portfolio/deploy.sh --undo "$1"; exit 1; }' check "$APP_IMAGE"
                                '''
                                // Old tags on the deploy host: only with the list of what the server runs and
                                // ran before. A file that cannot be read ends this step with nothing removed.
                                sh '''
                                    set -eu
                                    state="$(docker run --rm --user "$DEPLOY_USER" --cap-drop ALL --security-opt no-new-privileges --read-only --network none --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 \
                                        -v /docker/portfolio:/state:ro "$DEPLOY_CLI_IMAGE" \
                                        sh -ec 'cd /state; files=release.env; [ ! -e previous.env ] || files="$files previous.env"; cat $files')"
                                    # Read first, filtered afterwards: a failed read must not look like a short list.
                                    KEEP_IMAGES="$(echo "$state" | sed -n 's/^APP_IMAGE=//p')"
                                    [ -n "$KEEP_IMAGES" ] || { echo 'no release recorded: no image is removed' >&2; exit 1; }
                                    export KEEP_IMAGES
                                    sh scripts/ci.sh --clean-images
                                '''
                            }
                        }
                    }
                }
            }
        }
    }

    post {
        failure { echo 'Pipeline failed. If stage 10 or 11 ran, read /docker/portfolio/releases.log.' }
    }
}
