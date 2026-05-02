pipeline {
    agent any

    stages {
        stage('Clone') {
            steps {
                git credentialsId: 'github-token',
                    url: 'https://github.com/Rastrith156/ai-secure-devops-pipeline.git'
            }
        }

        stage('Install') {
            steps {
                sh 'pip install -r requirements.txt'
            }
        }

        stage('Test') {
            steps {
                sh 'pytest'
            }
        }

        stage('AI Security Scan') {
    steps {
        sh 'python3 security_scan.py'
    }
}

        stage('Deploy') {
            steps {
                echo "Deploying..."
            }
        }
    }
}
