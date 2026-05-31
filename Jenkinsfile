pipeline {
    agent any

    environment {
        IMAGE_NAME = "ai-secure-app"
        IMAGE_TAG  = "${env.BUILD_NUMBER}"
    }

    triggers {
        pollSCM('H/5 * * * *')
    }

    stages {

        stage('Install') {
            steps {
                sh '''
                echo "Creating virtual environment..."
                python3 -m venv venv

                echo "Installing dependencies..."
                . venv/bin/activate
                pip install --upgrade pip
                pip install -r requirements.txt -r requirements-dev.txt
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                echo "Running tests..."
                . venv/bin/activate
                mkdir -p test-results
                python3 -m pytest tests/ -v --tb=short --junitxml=test-results/results.xml
                '''
            }
            post {
                always {
                    junit 'test-results/*.xml'
                }
            }
        }

        stage('AI Security Scan') {
            steps {
                sh '''
                echo "Running secret scan..."
                . venv/bin/activate
                python3 security_scan.py
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                echo "Building Docker image..."
                docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
                docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                '''
            }
        }

        stage('Vulnerability Scan (Trivy)') {
            steps {
                sh '''
                echo "Scanning image with Trivy..."
                trivy image --exit-code 1 --severity HIGH,CRITICAL ${IMAGE_NAME}:${IMAGE_TAG}
                '''
            }
        }

        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                echo "Deploying application (simulation)..."
                echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
            }
        }
    }

    post {
        success {
            echo "Pipeline completed successfully — build #${env.BUILD_NUMBER}"
        }
        failure {
            echo "Pipeline failed — build #${env.BUILD_NUMBER}"
            mail(
                to: 'team@example.com',
                subject: "Build Failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                body: """
Build ${env.BUILD_NUMBER} of ${env.JOB_NAME} failed.
Check the console: ${env.BUILD_URL}
                """.stripIndent()
            )
        }
        always {
            cleanWs()
        }
    }
}
